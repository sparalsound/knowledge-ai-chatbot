#!/usr/bin/env python3
"""
scratch_gemini_ingest_v2.py
============================
고도화 RAG 학습 파이프라인 v2

[변경된 부분]
  - Structured OCR: Gemini에게 마크다운 + HIERARCHY + TYPE 구조로 출력 요청
  - Document Index: 매뉴얼 1개당 TOC + 요약 포인트 1개 별도 저장 (미래 기능용)
  - Parent-Child Chunking: Child(검색)는 400자, Parent(문맥)는 전체 페이지
  - 풍부한 메타데이터: hierarchy, content_type, table_summary, heading, document_id

[유지된 부분 — 절대 변경 없음]
  - Notion 연동 (query_notion_manuals, get_notion_page)
  - PDF 배치 분할 (split_pdf_into_batches, 15페이지 단위)
  - Qdrant 업로드 인프라 (upload_batch)
  - --page_ids 인자 지원 (증분 학습)
  - 에러 재시도 + 쿨다운 로직
  - Gemini File API 업로드/삭제 흐름

[교체 포인트 — 이 변수만 바꾸면 전략 전환]
  CHUNKING_STRATEGY : "parent_child" | "simple"
  PARSER_BACKEND    : "gemini_structured" | "gemini_simple"
  CHILD_CHUNK_SIZE  : 정수 (기본 400자)
  EXTRACT_DOC_INDEX : True | False
"""

import os
import sys
import time
import uuid
import json
import re
import argparse
import requests
from pypdf import PdfReader, PdfWriter
import google.generativeai as genai

# ══════════════════════════════════════════════
# 교체 포인트 (Swap to change strategy)
# ══════════════════════════════════════════════
CHUNKING_STRATEGY  = "parent_child"      # "parent_child" | "simple"
PARSER_BACKEND     = "gemini_structured" # "gemini_structured" | "gemini_simple"
CHILD_CHUNK_SIZE   = 400                 # 자식 청크 최대 글자 수
CHILD_CHUNK_OVERLAP = 80                 # 청크 간 겹침 글자 수
EXTRACT_DOC_INDEX  = True                # 문서 레벨 TOC/요약 포인트 저장 여부

# ══════════════════════════════════════════════
# API 키 및 연결 설정 (v1과 동일)
# ══════════════════════════════════════════════
# Load secrets from secrets.json
secrets_path = os.path.join(os.path.dirname(__file__), "secrets.json")
if not os.path.exists(secrets_path):
    raise FileNotFoundError("secrets.json file not found! Please create it in the project root directory.")
with open(secrets_path, "r", encoding="utf-8") as f:
    secrets = json.load(f)

notion_token    = secrets.get("notion_token")
database_id     = secrets.get("database_id")
gemini_key      = secrets.get("gemini_key")
qdrant_url      = "http://localhost:6333"
collection_name = "notion_manuals_v2"

os.environ["GEMINI_API_KEY"] = gemini_key
genai.configure(api_key=gemini_key)

# ══════════════════════════════════════════════
# 구조화 OCR 프롬프트 (신규)
# ══════════════════════════════════════════════
STRUCTURED_OCR_PROMPT = """이 PDF 파일은 총 {page_count}페이지로 구성된 한국어 업무 매뉴얼/문서의 일부분입니다.
아래 규칙에 따라 정확히 구조화하여 추출해주세요. 내용을 절대 생략하거나 요약하지 마세요.

[페이지 매핑 중요 규칙]
- 이 PDF 파일은 총 {page_count}페이지입니다. 출력할 때 === PAGE 1 === 부터 === PAGE {page_count} === 까지 순차적으로 누락 없이 출력해야 합니다.
- 각 페이지 본문 모서리나 머리말, 꼬리말 등에 인쇄되어 있는 페이지 번호(예: "9", "Page 9", "101" 등)는 절대로 무시하십시오.
- 오직 입력된 PDF 파일 내에서의 물리적인 페이지 순서(첫 번째 페이지는 PAGE 1, 두 번째 페이지는 PAGE 2, ..., {page_count}번째 페이지는 PAGE {page_count})에만 맞춰 매핑해야 합니다.

[출력 규칙]

1. 각 페이지 시작:
   === PAGE {번호} ===
   HIERARCHY: 대분류 > 중분류 > 소분류  (문서 목차/섹션 구조 기반으로 추론)
   TYPE: text

   이후 본문 내용 (제목은 # ## ###, 목록은 - 또는 1. 형식)

2. 표(Table)가 있는 경우 — 반드시 별도 블록으로 처리:
   === PAGE {번호} TABLE ===
   HIERARCHY: 대분류 > 중분류 > [표 제목]
   TYPE: table
   SUMMARY: [이 표가 다루는 내용을 1줄로 요약, 예: "배달 시간대별 처리 방법과 목표 소요시간"]

   | 컬럼1 | 컬럼2 | 컬럼3 |
   |-------|-------|-------|
   | 값    | 값    | 값    |

3. 한 페이지에 텍스트+표가 모두 있으면 텍스트 블록 먼저, 표 블록 다음으로 분리 출력
4. 이전 페이지와 같은 섹션이면 HIERARCHY 동일하게 유지
5. 모든 글자(메뉴 이름, 경고, 설명, 숫자, 코드 등) 원문 그대로 추출

예시 출력:
=== PAGE 1 ===
HIERARCHY: 배달 운영 > 시작하기
TYPE: text
# 배달 운영 매뉴얼 v2.0
본 매뉴얼은 신규 배달 가맹점의 운영 절차를 안내합니다.

=== PAGE 2 TABLE ===
HIERARCHY: 배달 운영 > 주문 처리 > 시간대별 기준
TYPE: table
SUMMARY: 시간대별 주문 처리 방법과 목표 소요시간 기준표
| 시간대 | 처리방법 | 목표시간 |
|--------|---------|---------|
| 오전   | 즉시처리 | 20분    |
| 오후   | 우선처리 | 15분    |
"""

# 단순 OCR 프롬프트 (fallback — PARSER_BACKEND="gemini_simple" 시 사용)
SIMPLE_OCR_PROMPT = """이 PDF 파일은 한국어 사용자 매뉴얼/문서입니다. 이 문서의 전체 내용을 각 페이지별로 나누어 텍스트로 정확히 추출해 주세요.
출력 형식:
=== PAGE 1 ===
[1페이지 텍스트 내용]

=== PAGE 2 ===
[2페이지 텍스트 내용]

포맷 변경이나 생략 없이, 한국어로 쓰여진 모든 글자를 있는 그대로 텍스트로 추출해 주시기 바랍니다."""

# 문서 인덱스 추출 프롬프트 (신규)
DOC_INDEX_PROMPT = """이 PDF 파일은 한국어 업무 매뉴얼입니다.
전체 문서의 구조를 분석하여 아래 JSON 형식으로만 응답해주세요. 다른 설명 텍스트나 마크다운 코드블록은 포함하지 마세요.

{
  "doc_summary": "이 매뉴얼이 다루는 내용을 3~5문장으로 요약",
  "main_topics": ["주요 주제1", "주요 주제2", "주요 주제3"],
  "toc": [
    {"heading": "1. 섹션 제목", "page": 1},
    {"heading": "1.1 소섹션 제목", "page": 3},
    {"heading": "2. 다른 섹션", "page": 8}
  ],
  "document_type": "매뉴얼 종류 (예: 업무절차, 제품사용, 정책규정, 배달운영 등)"
}"""


# ══════════════════════════════════════════════
# [유지] Qdrant 컬렉션 관리 (v1 동일)
# ══════════════════════════════════════════════
def recreate_collection():
    print(f"Recreating Qdrant collection: {collection_name}...")
    try:
        requests.delete(f"{qdrant_url}/collections/{collection_name}")
        payload = {"vectors": {"size": 3072, "distance": "Cosine"}}
        r = requests.put(f"{qdrant_url}/collections/{collection_name}", json=payload)
        r.raise_for_status()
        print("[OK] Collection recreated successfully!")
    except Exception as e:
        print(f"Error recreating collection: {e}")
        sys.exit(1)


# ══════════════════════════════════════════════
# [유지] Notion 연동 (v1 동일)
# ══════════════════════════════════════════════
def query_notion_manuals():
    print("Fetching manual list from Notion database...")
    headers = {
        "Authorization": f"Bearer {notion_token}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
    }
    url = f"https://api.notion.com/v1/databases/{database_id}/query"
    r = requests.post(url, headers=headers)
    r.raise_for_status()
    results = r.json().get("results", [])

    manuals = []
    for item in results:
        props = item.get("properties", {})
        title_prop = next((v for k, v in props.items() if isinstance(v, dict) and v.get("type") == "title"), {})
        titles = title_prop.get("title", []) if title_prop else []
        title_text = "".join([t.get("plain_text", "") for t in titles])

        file_prop = next((v for k, v in props.items() if isinstance(v, dict) and v.get("type") == "files"), {})
        files = file_prop.get("files", []) if file_prop else []
        if not files:
            continue

        file_name = files[0].get("name")
        file_url = files[0].get("file", {}).get("url") or files[0].get("external", {}).get("url")

        manuals.append({
            "id": item.get("id"),
            "title": title_text,
            "filename": file_name,
            "url": file_url
        })
    print(f"Found {len(manuals)} manuals in Notion.")
    return manuals


def get_notion_page(page_id):
    print(f"Fetching Notion page {page_id}...")
    headers = {
        "Authorization": f"Bearer {notion_token}",
        "Notion-Version": "2022-06-28"
    }
    url = f"https://api.notion.com/v1/pages/{page_id}"
    r = requests.get(url, headers=headers)
    r.raise_for_status()
    item = r.json()

    props = item.get("properties", {})
    title_prop = next((v for k, v in props.items() if isinstance(v, dict) and v.get("type") == "title"), {})
    titles = title_prop.get("title", []) if title_prop else []
    title_text = "".join([t.get("plain_text", "") for t in titles])

    file_prop = next((v for k, v in props.items() if isinstance(v, dict) and v.get("type") == "files"), {})
    files = file_prop.get("files", []) if file_prop else []
    if not files:
        raise ValueError(f"No file attached to page {page_id}")

    file_name = files[0].get("name")
    file_url = files[0].get("file", {}).get("url") or files[0].get("external", {}).get("url")
    team_id = item.get("parent", {}).get("database_id", "unknown_team")
    last_edited = item.get("last_edited_time", "")

    return {
        "id": item.get("id"),
        "title": title_text,
        "filename": file_name,
        "url": file_url,
        "team": team_id,
        "last_edited_time": last_edited
    }


# ══════════════════════════════════════════════
# [유지] PDF 다운로드 및 배치 분할 (v1 동일)
# ══════════════════════════════════════════════
def download_file(url, local_path):
    print(f"Downloading PDF to {local_path}...")
    r = requests.get(url, stream=True)
    r.raise_for_status()
    with open(local_path, "wb") as f:
        for chunk in r.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)
    print("Download complete.")


def split_pdf_into_batches(pdf_path, batch_size=15):
    """Split PDF into smaller PDFs of batch_size pages each. (v1 동일)"""
    print(f"Splitting PDF into {batch_size}-page batches...")
    reader = PdfReader(pdf_path)
    total_pages = len(reader.pages)

    batch_files = []
    for i in range(0, total_pages, batch_size):
        writer = PdfWriter()
        for j in range(i, min(i + batch_size, total_pages)):
            writer.add_page(reader.pages[j])

        # 파일명에 시작 페이지(i) 기록 — 이후 실제 페이지 번호 계산에 사용
        batch_filename = f"batch_{i}_temp_manual_{os.path.basename(pdf_path)}"
        with open(batch_filename, "wb") as f:
            writer.write(f)
        batch_files.append(batch_filename)

    print(f"Created {len(batch_files)} batches. Total pages: {total_pages}")
    return batch_files, total_pages


# ══════════════════════════════════════════════
# [유지] Qdrant 업로드 (v1 동일)
# ══════════════════════════════════════════════
def upload_batch(points):
    url = f"{qdrant_url}/collections/{collection_name}/points?wait=true"
    payload = {"points": points}
    r = requests.put(url, json=payload)
    r.raise_for_status()


# ══════════════════════════════════════════════
# [신규 — 교체 포인트 A] 구조화 OCR 추출
# ══════════════════════════════════════════════
def extract_structured_text_with_gemini(pdf_path, manual_title, batch_idx, total_batches):
    """
    Gemini에게 마크다운 구조화 형태로 OCR 추출 요청.
    PARSER_BACKEND에 따라 프롬프트 전환 가능.
    """
    print(f"[{batch_idx}/{total_batches}] Uploading {pdf_path} to Gemini for structured OCR...")
    sample_file = genai.upload_file(
        path=pdf_path,
        display_name=f"Manual - {manual_title} - Batch {batch_idx}"
    )

    while sample_file.state.name == "PROCESSING":
        time.sleep(3)
        sample_file = genai.get_file(sample_file.name)

    if sample_file.state.name == "FAILED":
        raise ValueError(f"Gemini file processing failed: {sample_file.error.message}")

    print(f"[{batch_idx}/{total_batches}] Requesting structured extraction...")
    model = genai.GenerativeModel(model_name="gemini-2.5-flash")

    # 교체 포인트: PARSER_BACKEND 변수로 프롬프트 선택
    if PARSER_BACKEND == "gemini_structured":
        reader = PdfReader(pdf_path)
        page_count = len(reader.pages)
        prompt = STRUCTURED_OCR_PROMPT.replace("{page_count}", str(page_count))
    else:
        prompt = SIMPLE_OCR_PROMPT

    extracted_text = ""
    retries = 3
    while retries > 0:
        try:
            response = model.generate_content([sample_file, prompt])
            extracted_text = response.text
            break
        except ValueError as ve:
            print(f"[{batch_idx}/{total_batches}] Safety/Empty Response: {ve}")
            extracted_text = ""
            break
        except Exception as e:
            print(f"[{batch_idx}/{total_batches}] API Error: {e}. Retrying in 10s...")
            time.sleep(10)
            retries -= 1
            if retries == 0:
                raise e

    # Gemini 파일 정리 (v1 동일)
    try:
        genai.delete_file(sample_file.name)
    except Exception as e:
        print(f"Warning: Failed to delete Gemini file: {e}")

    if batch_idx < total_batches:
        print(f"[{batch_idx}/{total_batches}] Cooling down 5s...")
        time.sleep(5)

    return extracted_text


# ══════════════════════════════════════════════
# [신규] 문서 인덱스 추출 (매뉴얼당 1회)
# ══════════════════════════════════════════════
def extract_document_index(first_batch_pdf, manual):
    """
    첫 번째 배치 PDF를 사용해 문서 전체의 목차(TOC) + 요약 추출.
    결과는 Qdrant에 doc_type="index" 특수 포인트로 저장됨.
    나중에 목차 카드, 매뉴얼 요약 기능에 바로 활용 가능.
    """
    print(f"  📑 Extracting document index for '{manual['title']}'...")
    try:
        sample_file = genai.upload_file(
            path=first_batch_pdf,
            display_name=f"Index - {manual['title']}"
        )
        while sample_file.state.name == "PROCESSING":
            time.sleep(3)
            sample_file = genai.get_file(sample_file.name)

        if sample_file.state.name == "FAILED":
            print(f"  Document index upload failed. Skipping.")
            return None

        model = genai.GenerativeModel(model_name="gemini-2.5-flash")
        doc_index = None
        retries = 3
        while retries > 0:
            try:
                response = model.generate_content([sample_file, DOC_INDEX_PROMPT])
                raw = response.text.strip()
                # 마크다운 코드블록 제거
                raw = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.MULTILINE)
                raw = re.sub(r'\s*```$', '', raw, flags=re.MULTILINE)
                doc_index = json.loads(raw)
                break
            except (json.JSONDecodeError, ValueError) as e:
                print(f"  JSON parse error: {e}. Retrying...")
                retries -= 1
                time.sleep(5)
            except Exception as e:
                print(f"  Error: {e}. Retrying...")
                retries -= 1
                time.sleep(10)

        try:
            genai.delete_file(sample_file.name)
        except:
            pass

        if doc_index:
            toc_count = len(doc_index.get("toc", []))
            print(f"  [OK] Document index extracted: {toc_count} TOC entries")
        else:
            print(f"  [WARN]  Document index extraction failed. Proceeding without index.")

        return doc_index

    except Exception as e:
        print(f"  Error in extract_document_index: {e}")
        return None


def upload_document_index(doc_index, manual):
    """
    문서 인덱스를 Qdrant에 특수 포인트(doc_type="index")로 저장.
    일반 청크와 구분되어, 나중에 목차 카드/요약 기능에서 별도 조회 가능.
    """
    if not doc_index:
        return

    manual_title    = manual["title"]
    team            = manual.get("team", "unknown_team")
    notion_page_id  = manual["id"]
    document_id     = f"{notion_page_id}-v{time.strftime('%Y%m%d')}"

    doc_summary  = doc_index.get("doc_summary", "")
    main_topics  = doc_index.get("main_topics", [])
    toc          = doc_index.get("toc", [])
    document_type = doc_index.get("document_type", "")

    # 검색 가능한 임베딩 텍스트 구성
    index_content = (
        f"[매뉴얼 개요: {manual_title}]\n"
        f"{doc_summary}\n"
        f"주요 주제: {', '.join(main_topics)}"
    )

    print(f"  Generating embedding for document index...")
    retries = 3
    embedding = None
    while retries > 0:
        try:
            res = genai.embed_content(
                model="models/gemini-embedding-2",
                content=index_content,
                task_type="retrieval_document"
            )
            embedding = res["embedding"]
            break
        except Exception as e:
            print(f"  Embedding error: {e}. Retrying...")
            time.sleep(2)
            retries -= 1

    if not embedding:
        print(f"  [WARN]  Failed to embed document index. Skipping.")
        return

    point = {
        "id": str(uuid.uuid4()),
        "vector": embedding,
        "payload": {
            "content": index_content,
            "parent_content": index_content,
            "metadata": {
                "manual_name":      manual_title,
                "doc_type":         "index",          # 일반 청크와 구분 키
                "doc_summary":      doc_summary,
                "main_topics":      main_topics,
                "toc":              toc,              # 목차 카드 기능용
                "document_type":    document_type,
                "total_toc_entries": len(toc),
                "team":             team,
                "notion_page_id":   notion_page_id,
                "document_id":      document_id,
                "source":           manual.get("filename", ""),
                "page":             0,
                "hierarchy":        "문서 개요",
                "content_type":     "index"
            }
        }
    }

    upload_batch([point])
    print(f"  [OK] Document index point uploaded.")


# ══════════════════════════════════════════════
# [신규 — 교체 포인트 B] 구조화 OCR 파싱
# ══════════════════════════════════════════════
def parse_structured_ocr(text, batch_start_page=0, page_count=15):
    """
    Gemini가 출력한 구조화 텍스트를 page_block 리스트로 파싱.
    각 block: {page, hierarchy, content_type, table_summary, heading, content}

    [보정 로직 적용]
      1. 첫 페이지 출력이 물리 순서 1이 아닌 인쇄 페이지 번호(예: 9P)로 어긋나 출력된 경우,
         first_raw_page를 추출하여 전체 페이지 번호에 적절한 오프셋(offset)을 적용해 보정합니다.
      2. 페이지 번호가 시퀀스를 벗어나거나 page_count를 넘어가면 순차 번호로 자동 강제 보정합니다.
    """
    blocks = []
    # "=== PAGE " 기준으로 분할
    parts = re.split(r'={3,}\s*PAGE\s+', text)

    # 1. 인쇄 페이지 번호 시작에 의한 오프셋 감지 및 보정 오프셋 계산
    first_raw_page = None
    for part in parts:
        part = part.strip()
        if not part:
            continue
        lines = part.split('\n')
        first_line = lines[0].strip()
        page_match = re.match(r'^(\d+)(?:\s+TABLE)?\s*={3,}', first_line)
        if page_match:
            first_raw_page = int(page_match.group(1))
            break

    page_offset = 0
    if first_raw_page is not None and (first_raw_page > 3 or first_raw_page > page_count):
        page_offset = -(first_raw_page - 1)
        print(f"  [Correction] Detected printed page offset error. First page output: {first_raw_page}. Applying offset: {page_offset}")

    # 2. 순차 보정용 상태 변수
    current_physical_page = 1
    last_raw_page = None

    for part in parts:
        part = part.strip()
        if not part:
            continue

        lines = part.split('\n')
        first_line = lines[0].strip()

        # 페이지 번호 + TABLE 여부 파싱
        page_match = re.match(r'^(\d+)(?:\s+TABLE)?\s*={3,}', first_line)
        if not page_match:
            continue

        raw_relative_page = int(page_match.group(1))
        relative_page = raw_relative_page + page_offset
        if relative_page < 1:
            relative_page = 1

        # 순차 범위 체크 및 강제 보정
        if last_raw_page is None:
            last_raw_page = raw_relative_page
            if relative_page > page_count:
                relative_page = 1
            current_physical_page = relative_page
        else:
            if raw_relative_page == last_raw_page:
                # 동일 페이지 (텍스트 + 표 분할 등)
                relative_page = current_physical_page
            else:
                last_raw_page = raw_relative_page
                if relative_page > current_physical_page and relative_page <= page_count:
                    current_physical_page = relative_page
                else:
                    current_physical_page += 1
                    relative_page = current_physical_page

        actual_page    = relative_page + batch_start_page
        is_table_block = bool(re.search(r'\bTABLE\b', first_line, re.IGNORECASE))

        # 메타 라인 파싱 (HIERARCHY, TYPE, SUMMARY)
        hierarchy      = "미분류"
        # [버그 수정] TABLE 블록 마커가 TYPE 라인보다 우선 — is_table_block이 True면 절대 text로 덮어쓰지 않음
        content_type   = "table" if is_table_block else "text"
        table_summary  = ""
        heading        = ""
        content_start  = 1  # 첫 줄(페이지마커) 다음부터

        for j in range(1, len(lines)):
            stripped = lines[j].strip()
            if stripped.startswith("HIERARCHY:"):
                hierarchy = stripped.replace("HIERARCHY:", "").strip()
                content_start = j + 1
            elif stripped.startswith("TYPE:"):
                type_val = stripped.replace("TYPE:", "").strip().lower()
                # [버그 수정] TABLE 블록 마커가 있으면 TYPE: text로도 table 유지
                if not is_table_block and type_val in ("text", "table", "heading", "list"):
                    content_type = type_val
                content_start = j + 1
            elif stripped.startswith("SUMMARY:"):
                table_summary = stripped.replace("SUMMARY:", "").strip()
                content_start = j + 1
            elif stripped.startswith("#") and not heading:
                # 첫 번째 헤딩을 섹션 제목으로 기록 — break 하지 않고 content_start만 갱신
                heading = stripped.lstrip("#").strip()
                content_start = j  # 헤딩 자체도 content에 포함
                break
            elif stripped and not stripped.startswith(("HIERARCHY:", "TYPE:", "SUMMARY:")):
                # 본문 시작 — 현재 j가 content 시작
                content_start = j
                break

        content = "\n".join(lines[content_start:]).strip()
        if not content:
            continue

        blocks.append({
            "page":          actual_page,
            "hierarchy":     hierarchy,
            "content_type":  content_type,
            "table_summary": table_summary,
            "heading":       heading,
            "content":       content
        })

    return blocks


# ══════════════════════════════════════════════
# [신규 — 교체 포인트 C] Parent-Child 청킹
# ══════════════════════════════════════════════
def chunk_text_parent_child(page_blocks, manual, filename):
    """
    page_block 리스트를 Parent-Child 구조로 청킹.

    - 표(table): 행/열 관계 보존을 위해 분할 없이 1개 청크
    - 텍스트: CHILD_CHUNK_SIZE 자 단위로 분할, 겹침 CHILD_CHUNK_OVERLAP 자
    - parent_content: 해당 페이지/블록 전체 텍스트 (검색 후 LLM이 읽을 문맥)
    - content: 임베딩 대상 (출처 접두사 + 청크 본문)
    """
    chunks = []
    manual_title    = manual["title"]
    notion_page_id  = manual["id"]
    team            = manual.get("team", "unknown_team")
    last_edited     = manual.get("last_edited_time", "")
    document_id     = f"{notion_page_id}-v{time.strftime('%Y%m%d')}"

    for block in page_blocks:
        page_num      = block["page"]
        hierarchy     = block["hierarchy"]
        content_type  = block["content_type"]
        table_summary = block["table_summary"]
        heading       = block["heading"]
        parent_text   = block["content"]

        # 공통 메타데이터 기반
        base_meta = {
            "source":            filename,
            "manual_name":       manual_title,
            "page":              page_num,
            "hierarchy":         hierarchy,
            "content_type":      content_type,
            "table_summary":     table_summary,
            "heading":           heading,
            "doc_type":          "chunk",
            "document_id":       document_id,
            "notion_page_id":    notion_page_id,
            "team":              team,
            "last_edited_time":  last_edited,
        }

        # parent_content: LLM이 답변할 때 읽을 전체 문맥
        parent_content = f"[{manual_title} | {page_num}p | {hierarchy}]\n{parent_text}"

        if content_type == "table":
            # ── 표: 절대 분할 금지, 요약 접두사 추가 ──
            if table_summary:
                search_text = f"[표] {table_summary}\n{parent_text}"
            else:
                search_text = parent_text

            content = f"[출처: {manual_title} {page_num}p | {hierarchy}]\n{search_text}"
            chunks.append({
                "content":        content,
                "parent_content": parent_content,
                "metadata":       {**base_meta, "chunk_index": 0, "total_chunks_in_block": 1}
            })

        else:
            # ── 텍스트: Child 청크로 분할 ──
            if len(parent_text) <= CHILD_CHUNK_SIZE:
                # 작은 블록 — 분할 없이 1개
                content = f"[출처: {manual_title} {page_num}p | {hierarchy}]\n{parent_text}"
                chunks.append({
                    "content":        content,
                    "parent_content": parent_content,
                    "metadata":       {**base_meta, "chunk_index": 0, "total_chunks_in_block": 1}
                })
            else:
                # 큰 블록 — CHILD_CHUNK_SIZE 단위로 슬라이딩 분할
                sub_chunks = []
                start = 0
                while start < len(parent_text):
                    end = start + CHILD_CHUNK_SIZE
                    sub_chunks.append(parent_text[start:end])
                    if end >= len(parent_text):
                        break
                    start = end - CHILD_CHUNK_OVERLAP

                total = len(sub_chunks)
                for idx, sc in enumerate(sub_chunks):
                    content = (
                        f"[출처: {manual_title} {page_num}p"
                        f" ({idx+1}/{total}) | {hierarchy}]\n{sc}"
                    )
                    chunks.append({
                        "content":        content,
                        "parent_content": parent_content,  # 모든 Child가 같은 Parent 공유
                        "metadata":       {**base_meta, "chunk_index": idx, "total_chunks_in_block": total}
                    })

    print(f"  Generated {len(chunks)} parent-child chunks from {len(page_blocks)} page blocks.")
    return chunks


# ══════════════════════════════════════════════
# [유지 + 확장] 임베딩 생성 및 Qdrant 업로드
# ══════════════════════════════════════════════
def generate_embeddings_and_upload(chunks):
    """
    chunk["content"]를 임베딩하여 Qdrant에 업로드.
    payload에 content + parent_content + metadata 모두 저장.
    (v1 동일 구조, 필드만 풍부해짐)
    """
    print(f"  Generating embeddings for {len(chunks)} chunks...")
    points = []

    for idx, chunk in enumerate(chunks):
        if idx % 10 == 0:
            print(f"    chunk {idx}/{len(chunks)}...")

        retries = 3
        embedding = None
        while retries > 0:
            try:
                res = genai.embed_content(
                    model="models/gemini-embedding-2",
                    content=chunk["content"],
                    task_type="retrieval_document"
                )
                embedding = res["embedding"]
                break
            except Exception as e:
                print(f"    Embedding error: {e}. Retrying...")
                time.sleep(2)
                retries -= 1

        if not embedding:
            print(f"    Skipping chunk {idx} — embedding failed.")
            continue

        points.append({
            "id":     str(uuid.uuid4()),
            "vector": embedding,
            "payload": {
                "content":        chunk["content"],
                "parent_content": chunk.get("parent_content", chunk["content"]),
                "metadata":       chunk["metadata"]
            }
        })

        # 20개 단위 배치 업로드 (v1 동일)
        if len(points) >= 20:
            upload_batch(points)
            points = []

    if points:
        upload_batch(points)

    print(f"  [OK] Upload complete.")


# ══════════════════════════════════════════════
# 메인 파이프라인 (인프라 구조 v1 동일, 내부 로직만 교체)
# ══════════════════════════════════════════════
def main():
    parser = argparse.ArgumentParser(description="고도화 RAG 학습 파이프라인 v2")
    parser.add_argument("--page_ids",   type=str, help="Comma-separated Notion page IDs (증분 학습)")
    parser.add_argument("--batch_size", type=int, default=15, help="PDF 배치당 페이지 수 (기본: 15)")
    parser.add_argument("--no_index",   action="store_true", help="문서 인덱스 추출 건너뜀")
    args = parser.parse_args()

    print(f"\n{'='*55}")
    print(f"  고도화 RAG 학습 파이프라인 v2")
    print(f"  전략: {PARSER_BACKEND} / {CHUNKING_STRATEGY}")
    print(f"  Child 청크 크기: {CHILD_CHUNK_SIZE}자 / 겹침: {CHILD_CHUNK_OVERLAP}자")
    print(f"{'='*55}\n")

    start_time   = time.time()
    total_chunks = 0

    # ── 1. Notion 매뉴얼 목록 (v1 동일) ──
    if args.page_ids:
        target_ids = [pid.strip() for pid in args.page_ids.split(",")]
        manuals = []
        for pid in target_ids:
            try:
                manuals.append(get_notion_page(pid))
            except Exception as e:
                print(f"Failed to fetch page {pid}: {e}")
        print(f"Fetched {len(manuals)} manuals by --page_ids")
        if not manuals:
            print("No matching manuals. Exiting.")
            return
    else:
        manuals = query_notion_manuals()

    # ── 2. Qdrant 컬렉션 초기화 (v1 동일) ──
    if not args.page_ids:
        recreate_collection()
    else:
        print("Incremental sync: skipping collection recreation.")

    # ── 3. 매뉴얼별 처리 ──
    for m_idx, manual in enumerate(manuals):
        print(f"\n{'-'*55}")
        print(f"  [{m_idx+1}/{len(manuals)}] {manual['title']}")
        print(f"{'-'*55}")

        local_pdf = f"temp_manual_{manual['id']}.pdf"

        try:
            # 3-1. PDF 다운로드 (v1 동일)
            download_file(manual["url"], local_pdf)

            # 3-2. 배치 분할 (v1 동일)
            batch_files, total_pages = split_pdf_into_batches(local_pdf, batch_size=args.batch_size)

            # 3-3. [신규] 문서 인덱스 추출 (첫 배치 사용)
            if EXTRACT_DOC_INDEX and not args.no_index and batch_files:
                doc_index = extract_document_index(batch_files[0], manual)
                upload_document_index(doc_index, manual)
                time.sleep(3)  # 쿨다운

            # 3-4. 배치별 처리
            for b_idx, batch_pdf in enumerate(batch_files, 1):
                # 실제 시작 페이지 계산 (파일명에서 추출)
                # 파일명: batch_{start_page}_temp_manual_{id}.pdf
                try:
                    batch_start_page = int(os.path.basename(batch_pdf).split('_')[1])
                except Exception:
                    batch_start_page = (b_idx - 1) * args.batch_size

                try:
                    print(f"\n  [배치 {b_idx}/{len(batch_files)}] 시작 페이지: {batch_start_page + 1}")

                    # [교체] 구조화 OCR 추출
                    raw_text = extract_structured_text_with_gemini(
                        batch_pdf, manual["title"], b_idx, len(batch_files)
                    )

                    # 디버그 파일 저장 (v1 동일)
                    debug_path = f"debug_v2_manual_{m_idx}_batch_{b_idx}.txt"
                    with open(debug_path, "w", encoding="utf-8") as f:
                        f.write(raw_text)

                    # 해당 배치의 실제 물리 페이지 수 계산
                    try:
                        batch_reader = PdfReader(batch_pdf)
                        batch_page_count = len(batch_reader.pages)
                    except Exception:
                        batch_page_count = 15

                    # [교체] 구조화 파싱 (페이지 수 기반 보정 로직 연동)
                    page_blocks = parse_structured_ocr(raw_text, batch_start_page=batch_start_page, page_count=batch_page_count)
                    print(f"  Parsed {len(page_blocks)} blocks (text+table) from batch {b_idx}")

                    if not page_blocks:
                        print(f"  [WARN]  No blocks parsed. Check debug_v2_manual_{m_idx}_batch_{b_idx}.txt")
                        continue

                    # [교체] Parent-Child 청킹
                    if CHUNKING_STRATEGY == "parent_child":
                        chunks = chunk_text_parent_child(page_blocks, manual, manual["filename"])
                    else:
                        # fallback: simple chunking (v1 호환)
                        from scratch_gemini_ingest import chunk_text as simple_chunk_text
                        full_text = "\n\n".join(
                            f"=== PAGE {b['page']} ===\n{b['content']}" for b in page_blocks
                        )
                        chunks = simple_chunk_text(full_text, manual, manual["filename"])

                    total_chunks += len(chunks)

                    if chunks:
                        generate_embeddings_and_upload(chunks)

                except Exception as batch_err:
                    print(f"  [ERR] Error in batch {b_idx}: {batch_err}")
                    import traceback; traceback.print_exc()
                finally:
                    if os.path.exists(batch_pdf):
                        os.remove(batch_pdf)

        except Exception as e:
            print(f"[ERR] Error processing '{manual['title']}': {e}")
            import traceback; traceback.print_exc()
        finally:
            if os.path.exists(local_pdf):
                os.remove(local_pdf)

    elapsed = time.time() - start_time
    print(f"\n{'='*55}")
    print(f"  [OK] v2 학습 완료! ({elapsed:.1f}초)")
    print(f"  저장된 총 청크: {total_chunks}개")
    print(f"  Qdrant 컬렉션: {collection_name}")
    print(f"{'='*55}\n")


if __name__ == "__main__":
    main()
