"""Local development server.

Python's built-in `http.server` lets the browser cache files, so an edit
often does not appear until a hard refresh - and sometimes not even then.
This sends no-cache headers on every response, so a normal refresh always
shows the latest code.

Run it with:

    python serve.py
"""

import http.server
import socketserver

PORT = 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Quieter: only report anything that is not a plain success.
        status = args[1] if len(args) > 1 else ""
        if not str(status).startswith("2"):
            super().log_message(fmt, *args)


class Server(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    with Server(("", PORT), NoCacheHandler) as httpd:
        print("Serving http://localhost:%d with caching disabled." % PORT)
        print("Press Ctrl+C to stop.")
        httpd.serve_forever()
