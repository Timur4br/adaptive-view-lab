import sys,unittest,re
from html.parser import HTMLParser
from urllib.parse import urlsplit,unquote
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'research'))
import run_experiments as ref
ROOT=Path(__file__).resolve().parents[1]

class LinkParser(HTMLParser):
    def __init__(self):super().__init__();self.links=[]
    def handle_starttag(self,tag,attrs):
        for name,value in attrs:
            if name in ['href','src'] and value:self.links.append(value)

class ReferenceTests(unittest.TestCase):
    def test_noiseless_and_jacobian(self):
        result=ref.diagnostics()
        self.assertLess(result['noiseless_length_error_mm'],1e-6)
        self.assertLess(result['projection_jacobian_max_abs_difference'],1e-5)

    def test_covariance_prediction_reduces_or_preserves_variance(self):
        C,R,family,_=ref.fixture(ref.SCENARIOS['balanced'])
        obs,_,visible=ref.project(ref.P_TRUE[None],C,R)
        selected=np.zeros((1,len(C)),bool);selected[:,:6]=True
        points,H,cov=ref.fit(obs,selected,C,R,visible)
        _,variance,g,_,floor=ref.measure(points,cov,np.array([ref.L_TRUE]),.05)
        predicted,_=ref.predict(points,H,g,floor,C,R)
        self.assertTrue(np.all(predicted<=variance[:,None]+1e-8))

    def test_all_local_html_links_exist(self):
        for filename in ROOT.rglob('*.html'):
            parser=LinkParser();parser.feed(filename.read_text(encoding='utf-8'))
            for url in parser.links:
                parsed=urlsplit(url)
                if parsed.scheme or parsed.netloc or not parsed.path:continue
                self.assertFalse(parsed.path.startswith('/'),f'Absolute site path: {url}')
                target=(filename.parent/unquote(parsed.path)).resolve()
                self.assertTrue(target.is_relative_to(ROOT.resolve()),f'Outside project: {url}')
                self.assertTrue(target.exists(),f'{filename.name}: missing {url}')

if __name__=='__main__':unittest.main()
