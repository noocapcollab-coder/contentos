// lib/clients.js — the client roster for Content OS.
//
// `name` must match the Client select option in the CONTENT STATS Notion
// database exactly. `key` is the private portal key a client gets in their
// link (https://<your-app>.vercel.app/?k=<key>). To revoke a client's link,
// change their key and redeploy. To add a client, add a line here and add the
// same name as a Client option in Notion.

export const CLIENTS = [
  { name: 'Brad',    key: 'brad-q7m2x9ka' },
  { name: 'Chris',   key: 'chris-r4v8n1tz' },
  { name: 'Lindsay', key: 'lind-w3p6k0ye' },
  { name: 'Duncan',  key: 'dunc-h9s2m5qb' },
  { name: 'Valeri',  key: 'val-c8x1f7ju' },
  { name: 'Emtech',  key: 'emt-z5k3r8wd' },
  { name: 'David',   key: 'dav-n2y7t4ls' },
  { name: 'Nicole',  key: 'nic-b6j9q3ve' }
];

export const clientByKey = k => CLIENTS.find(c => c.key === k) || null;
export const clientByName = n => CLIENTS.find(c => c.name.toLowerCase() === String(n || '').toLowerCase()) || null;
