#!/usr/bin/env python3
"""Start the Vinea CRM and open it in the browser.

    python3 crm.py            # http://127.0.0.1:5566
    python3 crm.py --no-open  # just the server
"""

import sys
import threading
import webbrowser

import uvicorn

from crm import config
from crm.app import create_app


def main() -> None:
    url = f"http://127.0.0.1:{config.PORT}"
    if "--no-open" not in sys.argv:
        threading.Timer(0.8, webbrowser.open, args=(url,)).start()
    print(f"Vinea CRM at {url}  (Ctrl+C to stop)")
    uvicorn.run(create_app(), host="127.0.0.1", port=config.PORT, log_level="warning")


if __name__ == "__main__":
    main()
