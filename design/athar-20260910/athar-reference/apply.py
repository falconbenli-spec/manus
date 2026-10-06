#!/usr/bin/env python3
"""Validate all input and target hashes before an optional reversible apply."""
import argparse,hashlib,json,os,shutil,tempfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('project',type=Path);p.add_argument('--apply',action='store_true');p.add_argument('--check',action='store_true');args=p.parse_args()
package=Path(__file__).resolve().parent;root=args.project.resolve();manifest=json.loads((package/'MANIFEST.json').read_text())
if not(root/'package.json').is_file():raise SystemExit('Target is not the project root.')
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
changes=[];conflicts=[]
for item in manifest['files']:
 rel=Path(item['path']);src=package/'source'/rel;dst=root/rel
 if rel.is_absolute() or '..' in rel.parts or not dst.resolve().is_relative_to(root) or dst.is_symlink():raise SystemExit('Unsafe path: '+str(rel))
 if digest(src)!=item['after_sha256']:raise SystemExit('Invalid package content: '+str(rel))
 current=digest(dst)
 if current==item['after_sha256']:continue
 if current==item['before_sha256'] or (current is None and item.get('allow_missing')):changes.append((item,src,dst,current))
 else:conflicts.append(str(rel))
if conflicts:
 print('STOP: newer or different files require a manual three-way merge. No files changed.\n'+'\n'.join(conflicts));raise SystemExit(2)
print(f'Validated {len(manifest["files"])} files; {len(changes)} require applying.')
if not args.apply or not changes:raise SystemExit(0)
backup=root/'.athar-backup'/manifest['checkpoint']
if backup.exists():raise SystemExit('Backup already exists. Review it before another application.')
written=[]
try:
 for item,src,dst,current in changes:
  if digest(dst)!=current:raise RuntimeError('Target changed during apply: '+item['path'])
  old=backup/item['path']
  if current is not None:old.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(dst,old)
  dst.parent.mkdir(parents=True,exist_ok=True)
  with tempfile.NamedTemporaryFile(dir=dst.parent,delete=False) as handle:
   handle.write(src.read_bytes());temp=Path(handle.name)
  os.chmod(temp,(dst.stat().st_mode if dst.exists() else src.stat().st_mode)&0o777)
  os.replace(temp,dst);written.append((dst,old,current))
 backup.mkdir(parents=True,exist_ok=True);(backup/'applied-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
 print('Applied. Original files retained at '+str(backup))
except Exception:
 for dst,old,current in reversed(written):
  if current is None:dst.unlink(missing_ok=True)
  else:shutil.copy2(old,dst)
 raise
