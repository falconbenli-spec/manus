// ت0: يقرأ نسخة مؤقتة من النسخة الاحتياطية المجرّبة بفتحها readOnly، ويكتب ما تحتاجه
// وثائق التنظيم إلى JSON. لا يستورد أي ملف من app/ ولا يفتح القاعدة الحية.
// الاستعمال: node docs/org/scripts/extract_backup.mjs <نسخة.sqlite> <مخرج.json>
// لا يُخرج معرّفات أشخاص ولا أسماءهم: يُحذف owner_id وprepared_by وpublished_by وdecided_by وbasis.
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';

const [src, out] = process.argv.slice(2);
if (!src || !out) throw new Error('usage: extract_backup.mjs <copy.sqlite> <out.json>');
const db = new DatabaseSync(src, { readOnly: true });
const all = (sql, ...p) => db.prepare(sql).all(...p).map((r) => ({ ...r }));
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

const migration = db.prepare('select max(version) v from schema_migrations').get()?.v ?? null;

const versions = all('select code, version, name_ar, description, fields, approval_policy, active from services order by code, version');
const services = {};
for (const v of versions) {
  const s = (services[v.code] ??= { code: v.code, names_by_version: [] });
  s.names_by_version.push(v.name_ar);
  Object.assign(s, {
    name_ar: v.name_ar,
    description: v.description,
    fields: parse(v.fields, []).map((f) => ({ key: f.key, label: f.label, type: f.type, required: !!f.required, options: f.options })),
    approval_policy: parse(v.approval_policy, {}),
    active: v.active,
    version: v.version,
  });
}
for (const s of Object.values(services)) s.old_names = [...new Set(s.names_by_version)].filter((n) => n !== s.name_ar);

for (const r of all("select item_key, term from service_synonyms where item_kind = 'service' order by item_key, term")) {
  const s = services[r.item_key];
  if (s) (s.synonyms ??= []).push(r.term);
}
for (const c of all('select service_code, status, short_description, eligibility_rules, required_documents, faq, policy_reference, confidentiality, requesters from service_cards')) {
  const s = services[c.service_code];
  if (!s) continue;
  s.card = {
    status: c.status,
    short_description: c.short_description,
    eligibility_rules: parse(c.eligibility_rules, {}),
    required_documents: parse(c.required_documents, []),
    faq: parse(c.faq, []),
    policy_reference: c.policy_reference,
    confidentiality: c.confidentiality,
  };
}
for (const d of all('select service_code, section, target_days, target_hours from service_directory')) {
  const s = services[d.service_code];
  if (s) Object.assign(s, { directory_section: d.section, directory_target_days: d.target_days, directory_target_hours: d.target_hours });
}

const policy_documents = all('select code, title, reference_no, status, verification, effective_from from policy_documents');
const policy_articles = all(`select d.code doc, a.number, a.title, a.status, a.verification from policy_articles a
  join policy_documents d on d.id = a.document_id order by d.code, a.chapter_order, a.number`);
const policy_request_basis = all('select key, label, article_number, kind from policy_request_basis');
const leave_type_policies = all('select title, parameters, status, effective_from from leave_type_policies').map((p) => {
  const prm = parse(p.parameters, {});
  return {
    title: p.title, status: p.status, effective_from: p.effective_from,
    types: (prm.types ?? []).map((t) => ({ code: t.code, name_ar: t.name_ar, articles: t.articles, documents: t.documents, eligibility: t.eligibility, entitlement: t.entitlement, unit: t.unit })),
  };
});
const counts = Object.fromEntries(['service_gate', 'service_availability', 'service_target_adoptions', 'catalog_placement'].map((t) => [t, db.prepare(`select count(*) c from ${t}`).get().c]));
const required_capability_filled = db.prepare("select count(*) c from catalog_placement where coalesce(required_capability,'') <> ''").get().c;

writeFileSync(out, JSON.stringify({
  source: 'نسخة مؤقتة من work/backups/m0-20260925/36t-20260925T1649.sqlite، مفتوحة readOnly',
  migration, counts, required_capability_filled,
  services, policy_documents, policy_articles, policy_request_basis, leave_type_policies,
}, null, 1));
db.close();
console.log('services', Object.keys(services).length, 'migration', migration, counts, 'required_capability_filled', required_capability_filled);
