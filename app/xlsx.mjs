import { deflateRawSync, crc32 } from 'node:zlib';

// كاتب XLSX صغير بلا مكتبات: حزمة OOXML حقيقية (ZIP) بورقة بيانات من اليمين لليسار وورقة تعريفات.
// الأرقام تُكتب أرقامًا، والنصوص نصوصًا صريحة فلا تُفسَّر خلية تبدأ بـ = أو + صيغة.
const CONTROL=new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]','g');
const BOM=String.fromCharCode(0xFEFF);
const xml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(CONTROL,'');
const column=index=>{let name='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;};
function sheetXml(rows,widths){
  const body=rows.map((row,r)=>`<row r="${r+1}">${row.map((cell,c)=>{
    const ref=`${column(c)}${r+1}`,style=r===0?' s="1"':'';
    if(cell===null||cell===undefined||cell==='')return '';
    if(typeof cell==='number'&&Number.isFinite(cell))return `<c r="${ref}"${r===0?style:' s="2"'}><v>${cell}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(cell)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData></worksheet>`;
}
function zip(files){
  const parts=[],central=[];let offset=0;
  for(const [name,content] of files){
    const nameBytes=Buffer.from(name,'utf8'),data=Buffer.from(content,'utf8'),packed=deflateRawSync(data),sum=crc32(data);
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x0800,6);local.writeUInt16LE(8,8);local.writeUInt32LE(0x00210000,10);local.writeUInt32LE(sum,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(nameBytes.length,26);
    parts.push(local,nameBytes,packed);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50,0);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x0800,8);entry.writeUInt16LE(8,10);entry.writeUInt32LE(0x00210000,12);entry.writeUInt32LE(sum,16);entry.writeUInt32LE(packed.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(nameBytes.length,28);entry.writeUInt32LE(offset,42);
    central.push(entry,nameBytes);offset+=30+nameBytes.length+packed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...parts,directory,end]);
}
// sheets: [{name, rows:[[…]], widths?}] — الصف الأول عناوين.
export function workbook(sheets){
  const safe=sheets.map((s,i)=>({...s,name:xml(String(s.name).replace(/[\\/?*:[\]]/g,' ').slice(0,31)||`Sheet${i+1}`),widths:s.widths??(s.rows[0]??[]).map((_,c)=>Math.min(60,Math.max(12,...s.rows.slice(0,200).map(r=>String(r[c]??'').length+2))))}));
  return zip([
    ['[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${safe.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${safe.map((s,i)=>`<sheet name="${s.name}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${safe.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${safe.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>'],
    ...safe.map((s,i)=>[`xl/worksheets/sheet${i+1}.xml`,sheetXml(s.rows,s.widths)])
  ]);
}
// CSV آمن: BOM للعربية، وخلية نصية تبدأ بما قد يُفسَّر صيغة تُسبق بفاصلة عليا.
export function csv(rows){
  const cell=value=>{const text=String(value??''),safe=typeof value==='string'&&/^[=+\-@\t\r]/.test(text)?`'${text}`:text;return /[",\n\r]/.test(safe)?`"${safe.replace(/"/g,'""')}"`:safe;};
  return BOM+rows.map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
}
