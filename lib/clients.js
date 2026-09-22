// lib/clients.js — the client roster for Content OS.
//
// `name` must match the Client select option in the CONTENT STATS Notion
// database exactly. `key` is the private portal key a client gets in their
// link (https://<your-app>.vercel.app/?k=<key>). To revoke a client's link,
// change their key and redeploy. To add a client, add a line here and add the
// same name as a Client option in Notion.

export const CLIENTS = [
  { name: 'Brad',     key: 'brad-d84zear5l7xvnws64gd7' },
  { name: 'Chris',    key: 'chri-9k95s6zsm0rxv4xub8rj' },
  { name: 'Lindsay',  key: 'lind-m3cgd5t276dn29dgqhbi' },
  { name: 'Duncan',   key: 'dunc-nwlyygpdsvmq1qy4wi5u' },
  { name: 'Valeri',   key: 'vale-16y0hxzn8fypys7jmid6' },
  { name: 'Emtech',   key: 'emte-1n5jvo50zv73hna6bd83' },
  { name: 'David',    key: 'davi-ixaz5hwbaf6qq6bajq1e' },
  { name: 'Nicole',   key: 'nico-kf5kwjyaoy00f6x5zn8e' }
];

export const clientByKey = k => CLIENTS.find(c => c.key === k) || null;
export const clientByName = n => CLIENTS.find(c => c.name.toLowerCase() === String(n || '').toLowerCase()) || null;
