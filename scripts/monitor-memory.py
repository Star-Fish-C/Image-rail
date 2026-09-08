"""Sample an isolated benchmark app and its descendants (RSS sum, not system RAM)."""
import json, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.tools' / 'python'))
import psutil
root = psutil.Process(int(sys.argv[1]))
output = Path(sys.argv[2])
peak = 0
samples = []
while root.is_running():
    try:
        processes = [root, *root.children(recursive=True)]
        rss = sum(p.memory_info().rss for p in processes if p.is_running())
        peak = max(peak, rss)
        samples.append(rss)
        output.write_text(json.dumps(dict(peakRssBytes=peak, samples=len(samples), lastRssBytes=rss)),encoding='utf-8')
        time.sleep(.1)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        break
