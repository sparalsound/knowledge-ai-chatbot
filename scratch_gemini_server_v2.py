from flask import Flask, request, jsonify
import threading
import subprocess
import os
import queue

app = Flask(__name__)

# 동기화 작업을 순차적으로 처리하기 위한 큐
sync_queue = queue.Queue()

def worker():
    while True:
        page_ids_str = sync_queue.get()
        if page_ids_str is None:
            break
            
        print(f"\n=======================================================")
        print(f"  🚀 Starting V2 background ingestion for pages:")
        print(f"  {page_ids_str}")
        print(f"  [Queue size: {sync_queue.qsize()}]")
        print(f"=======================================================\n")
        
        env = os.environ.copy()
        env['PYTHONIOENCODING'] = 'utf-8'
        
        try:
            subprocess.run(
                ["python", "C:/Users/User01/Desktop/AI AGENT/ChatbotT2/scratch_gemini_ingest_v2.py", "--page_ids", page_ids_str],
                env=env
            )
        except Exception as e:
            print(f"Error running ingestion script: {e}")
            
        print(f"\n=======================================================")
        print(f"  ✅ V2 background ingestion completed.")
        print(f"=======================================================\n")
        
        sync_queue.task_done()

# 워커 스레드 시작 (백그라운드에서 계속 실행되며 큐의 작업을 하나씩 처리)
worker_thread = threading.Thread(target=worker, daemon=True)
worker_thread.start()

@app.route('/sync_v2', methods=['POST'])
def sync_manuals_v2():
    try:
        data = request.json
    except Exception as e:
        print(f"JSON Parse Error: {e}")
        data = {}
            
    print(f"Parsed Request data: {data}")
    # n8n에서 통째로 전달한 pages 배열을 사용 (page_ids로 변경)
    page_ids = data.get('pages', [])
    
    if not page_ids:
        return jsonify({"status": "ignored", "message": "No page IDs provided"}), 200

    page_ids_str = ",".join(page_ids)
    
    # 큐에 작업 추가 (병목 현상, Rate Limit, 메모리 초과 방지)
    sync_queue.put(page_ids_str)
    
    return jsonify({"status": "success", "message": f"Queued V2 ingestion for {len(page_ids)} manuals. Queue size: {sync_queue.qsize()}"}), 200

if __name__ == '__main__':
    print("=======================================================")
    print("  🟢 V2 Background Ingestion Server Running on Port 5000")
    print("  - POST /sync_v2 (Task Queue Enabled)")
    print("=======================================================")
    app.run(host='0.0.0.0', port=5000)
