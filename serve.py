"""Local-only server for ES modules. No uploads or form submission handlers."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, HTTPServer
from pathlib import Path
import argparse

ROOT=Path(__file__).parent
class Handler(SimpleHTTPRequestHandler):
    extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json'}
    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        super().end_headers()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8767);a=parser.parse_args()
    server=HTTPServer(('127.0.0.1',a.port),partial(Handler,directory=str(ROOT)))
    print(f'OTS WebGL: http://127.0.0.1:{a.port}/ — local files only',flush=True)
    server.serve_forever()
