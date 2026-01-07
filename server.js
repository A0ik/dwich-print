const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = 3333;
const SECRET_KEY = process.env.PRINTER_SECRET || 'dwich62-secret-2024';
const W = 32; // Largeur caractères

const printedOrders = new Set();
let printQueue = [];
let isPrinting = false;

function alreadyPrinted(orderId) {
  if (printedOrders.has(orderId)) return true;
  printedOrders.add(orderId);
  if (printedOrders.size > 100) printedOrders.delete(printedOrders.values().next().value);
  return false;
}

async function addToQueue(order) {
  return new Promise((resolve) => {
    printQueue.push({ order, resolve });
    processQueue();
  });
}

async function processQueue() {
  if (isPrinting || printQueue.length === 0) return;
  isPrinting = true;
  const { order, resolve } = printQueue.shift();
  try { await printOrder(order); resolve(true); } 
  catch (e) { console.error('Erreur:', e.message); resolve(false); }
  isPrinting = false;
  processQueue();
}

const prix = (c) => (c / 100).toFixed(2).replace('.', ',');
const ctr = (t) => t.padStart(Math.floor((W + t.length) / 2)).padEnd(W);
const ln = () => '='.repeat(W);

function ticketCuisine(order) {
  let t = '';
  t += ctr('CUISINE') + '\n';
  t += ln() + '\n';
  t += ctr(order.orderType === 'delivery' ? 'LIVRAISON' : 'SUR PLACE') + '\n';
  t += ln() + '\n';
  order.items.forEach(i => {
    t += `${i.quantity||i.qty||1}x ${i.name.toUpperCase()}\n`;
    if (i.description||i.options) t += ` ${i.description||i.options}\n`;
  });
  t += ln() + '\n';
  t += ctr('#' + order.orderId) + '\n';
  t += ln() + '\n';
  const n = `${order.customerInfo?.firstName||''} ${order.customerInfo?.lastName||''}`.trim();
  t += `${n} ${order.customerInfo?.phone||''}\n`;
  if (order.orderType === 'delivery') {
    t += `${order.customerInfo?.address||''}\n`;
    t += `${order.customerInfo?.postalCode||''} ${order.customerInfo?.city||''}\n`;
  }
  if (order.customerInfo?.notes) t += `! ${order.customerInfo.notes}\n`;
  t += '\n';
  return t;
}

function ticketCaisse(order) {
  let t = '';
  t += ctr('DWICH 62') + '\n';
  t += ctr('135ter Rue Jules Guesde') + '\n';
  t += ctr('62800 LIEVIN') + '\n';
  t += ctr('07 67 46 95 02') + '\n';
  t += ln() + '\n';
  t += ctr('#' + order.orderId) + '\n';
  t += ln() + '\n';
  let sub = 0;
  order.items.forEach(i => {
    const q = i.quantity||i.qty||1, p = i.unitPrice||i.price||0;
    sub += p * q;
    const l = `${q}x ${i.name}`, r = prix(p*q);
    t += l + ' '.repeat(Math.max(1,W-l.length-r.length)) + r + '\n';
  });
  t += ln() + '\n';
  const liv = order.orderType === 'delivery' ? 500 : 0;
  if (liv) { const l='Livraison',r=prix(liv); t += l + ' '.repeat(W-l.length-r.length) + r + '\n'; }
  const tot = order.totalAmount || (sub + liv);
  t += ctr('TOTAL: ' + prix(tot) + ' EUR') + '\n';
  t += ln() + '\n';
  t += ctr(order.paymentMethod==='card'||order.paymentMethod==='stripe' ? 'PAYE CB' : '** A ENCAISSER **') + '\n';
  t += ln() + '\n';
  if (order.orderType === 'delivery') {
    const n = `${order.customerInfo?.firstName||''} ${order.customerInfo?.lastName||''}`.trim();
    t += `${n} ${order.customerInfo?.phone||''}\n`;
    t += `${order.customerInfo?.address||''}\n`;
    t += `${order.customerInfo?.postalCode||''} ${order.customerInfo?.city||''}\n`;
  }
  if (order.customerInfo?.notes) t += `! ${order.customerInfo.notes}\n`;
  t += ctr('Merci!') + '\n\n';
  return t;
}

async function printText(text) {
  return new Promise((resolve, reject) => {
    const f = path.join(__dirname, `t${Date.now()}.txt`);
    fs.writeFileSync(f, text, 'utf8');
    exec(`notepad /p "${f}"`, { timeout: 30000 }, (err) => {
      setTimeout(() => { try { fs.unlinkSync(f); } catch(e){} }, 5000);
      err ? reject(err) : resolve(true);
    });
  });
}

async function printOrder(order) {
  console.log(`#${order.orderId}...`);
  await printText(ticketCuisine(order));
  await new Promise(r => setTimeout(r, 2000));
  await printText(ticketCaisse(order));
  console.log(`#${order.orderId} OK`);
}

app.post('/print', async (req, res) => {
  const { secret, order } = req.body;
  if (secret !== SECRET_KEY) return res.status(401).json({ error: 'Unauthorized' });
  if (!order?.orderId) return res.status(400).json({ error: 'Missing order' });
  if (alreadyPrinted(order.orderId)) return res.json({ success: true, duplicate: true });
  const success = await addToQueue(order);
  res.json({ success, orderId: order.orderId });
});

app.get('/test', async (req, res) => {
  const id = Date.now().toString().slice(-4);
  const order = {
    orderId: id, orderType: 'delivery', paymentMethod: 'cash', totalAmount: 2200,
    items: [
      { name: 'Tacos XL', quantity: 1, unitPrice: 1100, description: 'Merguez, Cordon bleu' },
      { name: 'Coca 33cl', quantity: 2, unitPrice: 250 },
    ],
    customerInfo: { firstName: 'Mohamed', lastName: 'D', phone: '0612345678',
      address: '15 Rue Paix', postalCode: '62800', city: 'Lievin', notes: 'Code 1234' }
  };
  if (alreadyPrinted(id)) return res.send('Doublon');
  const ok = await addToQueue(order);
  res.send(ok ? 'OK!' : 'ERREUR');
});

app.get('/', (req, res) => res.send('<h1>DWICH62</h1><a href="/test">TEST</a>'));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`DWICH62 - Port ${PORT}`));
