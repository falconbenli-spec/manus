import test from 'node:test';
import assert from 'node:assert/strict';
import { reedSolomon, formatBits, versionBits, qrMatrix, qrSvg } from '../app/qr.mjs';

test('QR: error correction, format and version bits match the published ISO/IEC 18004 reference values',()=>{
  // مثال المواصفة: «01234567» بإصدار 1-M.
  const data=[0x10,0x20,0x0c,0x56,0x61,0x80,0xec,0x11,0xec,0x11,0xec,0x11,0xec,0x11,0xec,0x11];
  assert.deepEqual(reedSolomon(data,10),[0xa5,0x24,0xd4,0xc1,0xed,0x36,0xc7,0x87,0x2c,0x55]);
  assert.equal(formatBits(0).toString(2).padStart(15,'0'),'101010000010010','level M, mask 0');
  assert.equal(formatBits(5).toString(2).padStart(15,'0'),'100000011001110','level M, mask 5');
  assert.equal(versionBits(7).toString(2).padStart(18,'0'),'000111110010010100');
});

test('QR: structure is valid for every size used — finder patterns, timing, dark module, and a version that fits the payload',()=>{
  for(const length of [1,14,15,60,122,123,200,331,332,500,700]){
    const text='A'.repeat(length),{version,size,matrix}=qrMatrix(text);
    assert.equal(size,version*4+17);assert.equal(matrix.length,size);
    for(const [r0,c0] of [[0,0],[0,size-7],[size-7,0]]){
      for(let i=0;i<7;i++){assert.equal(matrix[r0][c0+i],true);assert.equal(matrix[r0+6][c0+i],true);assert.equal(matrix[r0+i][c0],true);assert.equal(matrix[r0+i][c0+6],true);}
      for(let i=1;i<6;i++){assert.equal(matrix[r0+1][c0+i],false);assert.equal(matrix[r0+5][c0+i],false);}
      for(let r=2;r<=4;r++)for(let c=2;c<=4;c++)assert.equal(matrix[r0+r][c0+c],true);
    }
    for(let i=8;i<size-8;i++){assert.equal(matrix[6][i],i%2===0,'row timing');assert.equal(matrix[i][6],i%2===0,'column timing');}
    assert.equal(matrix[size-8][8],true,'dark module');
  }
  assert.equal(qrMatrix('A'.repeat(14)).version,1);assert.equal(qrMatrix('A'.repeat(15)).version,2,'14 bytes is the 1-M byte capacity');
  assert.throws(()=>qrMatrix('A'.repeat(1400)),/too long/);
});

test('QR: the same payload always gives the same symbol, the mask is the lowest-penalty one, and the SVG carries no inline style',()=>{
  const payload='AQ1TeW50aGV0aWMgQ28CDzMwMDAwMDAwMDAwMDAwMwMUMjAyNi0wOS0xN1QxMDowMDowMFoEBzExNTAuMDAFBjE1MC4wMA==';
  const a=qrMatrix(payload),b=qrMatrix(payload);
  assert.deepEqual(a.matrix,b.matrix);
  assert.notDeepEqual(qrMatrix(payload,(a.mask+1)%8).matrix,a.matrix);
  const svg=qrSvg(payload);
  assert.match(svg,/^<svg [^>]*viewBox="0 0 \d+ \d+"/);assert.doesNotMatch(svg,/style=|<script|href=/);
  assert.ok(svg.includes('fill="#000"'));
});
