/**
 * DWICH62 - Serveur d'impression
 * Anti-doublons + File d'attente + Économie papier
 */

const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PRINTER_NAME = 'AURES ODP333';
const PORT = 3333;
const SECRET_KEY = process.env.PRINTER_SECRET || 'dwich62-secret-2024';

// Anti-doublons : garde les IDs des 100 dernières commandes
const printedOrders = new Set();
const MAX_HISTORY = 100;

// File d'attente
let printQueue = [];
let isPrinting = false;

// ============ ANTI-DOUBLONS ============
function alreadyPrinted(orderId) {
  if (printedOrders.has(orderId)) return true;
  printedOrders.add(orderId);
  if (printedOrders.size > MAX_HISTORY) {
    const first = printedOrders.values().next().value;
    printedOrders.delete(first);
  }
  return false;
}

// ============ FILE D'ATTENTE ============
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
  
  try {
    await printOrder(order);
    resolve(true);
  } catch (e) {
    console.error('Erreur:', e.message);
    resolve(false);
  }
  
  isPrinting = false;
  processQueue();
}

// ============ TICKET CUISINE ============
function generateKitchenTicket(order) {
  const l = [];
  const w = 42;
  const c = (t) => ' '.repeat(Math.max(0, Math.floor((w - t.length) / 2))) + t;
  const s = '-'.repeat(w);

  l.push(c('*** CUISINE ***'));
  l.push(s);
  l.push(c(`#${order.orderId}  ${formatTime(order.createdAt)}`));
  l.push(c(order.orderType === 'delivery' ? '>> LIVRAISON <<' : '>> SUR PLACE <<'));
  l.push(s);
  order.items.forEach(item => {
    const qty = item.quantity || item.qty || 1;
    l.push(`${qty}x ${item.name}`);
    const desc = item.description || item.options || '';
    if (desc) desc.split(',').forEach(o => { if (o.trim()) l.push(`  > ${o.trim()}`); });
  });
  l.push(s);
  if (order.customerInfo?.notes || order.notes) l.push(`NOTE: ${order.customerInfo?.notes || order.notes}`);
  const name = `${order.customerInfo?.firstName || ''} ${order.customerInfo?.lastName || ''}`.trim();
  l.push(`${name} - ${order.customerInfo?.phone || ''}`);
  if (order.orderType === 'delivery') {
    l.push(`${order.customerInfo?.address || ''}`);
    l.push(`${order.customerInfo?.postalCode || ''} ${order.customerInfo?.city || ''}`);
  }
  l.push(s);
  l.push('');
  return l.join('\n');
}

// ============ TICKET CAISSE ============
function generateCashierTicket(order) {
  const l = [];
  const w = 42;
  const c = (t) => ' '.repeat(Math.max(0, Math.floor((w - t.length) / 2))) + t;
  const s = '-'.repeat(w);
  const d = '='.repeat(w);
  const r = (a, b) => a + ' '.repeat(Math.max(1, w - a.length - b.length)) + b;

  l.push(d);
  l.push(c('DWICH62'));
  l.push(c('135 Ter Rue Jules Guesde'));
  l.push(c('62800 LIEVIN - 07 67 46 95 02'));
  l.push(d);
  l.push(r('Commande:', `#${order.orderId}`));
  l.push(r('Date:', `${formatDate(order.createdAt)} ${formatTime(order.createdAt)}`));
  l.push(r('Mode:', order.orderType === 'delivery' ? 'Livraison' : 'Sur place'));
  l.push(s);
  let subtotal = 0;
  order.items.forEach(item => {
    const qty = item.quantity || item.qty || 1;
    const price = item.unitPrice || item.price || 0;
    const tot = price * qty;
    subtotal += tot;
    l.push(r(`${qty}x ${item.name}`, formatPrice(tot)));
    const desc = item.description || item.options || '';
    if (desc) l.push(`  ${desc.substring(0, 39)}`);
  });
  l.push(s);
  l.push(r('Sous-total:', formatPrice(subtotal)));
  const del = order.orderType === 'delivery' ? 500 : 0;
  if (del > 0) l.push(r('Livraison:', formatPrice(del)));
  l.push(d);
  const total = order.totalAmount || (subtotal + del);
  l.push(r('TOTAL:', formatPrice(total)));
  l.push(d);
  if (order.paymentMethod === 'card' || order.paymentMethod === 'stripe') {
    l.push(c('PAYE PAR CB'));
  } else if (order.paymentMethod === 'cash') {
    l.push(c('** ENCAISSER LIVREUR **'));
  } else {
    l.push(c('** ENCAISSER SUR PLACE **'));
  }
  l.push(s);
  const name = `${order.customerInfo?.firstName || ''} ${order.customerInfo?.lastName || ''}`.trim();
  l.push(`Client: ${name} - ${order.customerInfo?.phone || ''}`);
  if (order.orderType === 'delivery') {
    l.push(`Adr: ${order.customerInfo?.address || ''}`);
    l.push(`${order.customerInfo?.postalCode || ''} ${order.customerInfo?.city || ''}`);
  }
  if (order.customerInfo?.notes || order.notes) l.push(`Note: ${order.customerInfo?.notes || order.notes}`);
  l.push(d);
  l.push(c('Merci ! - www.dwich62.fr'));
  l.push('');
  return l.join('\n');
}

function formatPrice(cents) { return (cents / 100).toFixed(2).replace('.', ','); }
function formatDate(d) { return (d ? new Date(d) : new Date()).toLocaleDateString('fr-FR'); }
function formatTime(d) { return (d ? new Date(d) : new Date()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }

// ============ IMPRESSION ============
async function printText(text) {
  return new Promise((resolve, reject) => {
    const f = path.join(__dirname, `t_${Date.now()}.txt`);
    fs.writeFileSync(f, text, 'latin1');
    exec(`powershell -Command "Get-Content '${f}' | Out-Printer '${PRINTER_NAME}'"`, { timeout: 15000 }, (err) => {
      setTimeout(() => { try { fs.unlinkSync(f); } catch (e) {} }, 500);
      err ? reject(err) : resolve(true);
    });
  });
}

async function printOrder(order) {
  console.log(`[${new Date().toLocaleTimeString()}] #${order.orderId}`);
  await printText(generateKitchenTicket(order));
  await new Promise(r => setTimeout(r, 500));
  await printText(generateCashierTicket(order));
  console.log(`[${new Date().toLocaleTimeString()}] #${order.orderId} OK`);
}

// ============ API ============
app.post('/print', async (req, res) => {
  const { secret, order } = req.body;
  if (secret !== SECRET_KEY) return res.status(401).json({ error: 'Unauthorized' });
  if (!order?.orderId) return res.status(400).json({ error: 'Missing order' });
  
  // Anti-doublon
  if (alreadyPrinted(order.orderId)) {
    console.log(`[DOUBLON] #${order.orderId} ignoré`);
    return res.json({ success: true, orderId: order.orderId, duplicate: true });
  }
  
  // Ajouter à la file
  const success = await addToQueue(order);
  res.json({ success, orderId: order.orderId });
});

app.get('/health', (req, res) => res.json({ status: 'ok', queue: printQueue.length }));

app.get('/test', async (req, res) => {
  const id = 'T' + Date.now().toString(36).toUpperCase().slice(-5);
  const order = {
    orderId: id, orderType: 'delivery', paymentMethod: 'cash', totalAmount: 2350,
    createdAt: new Date().toISOString(),
    items: [
      { name: 'Tacos XL', quantity: 2, unitPrice: 900, description: 'Poulet, Cordon bleu' },
      { name: 'Coca-Cola', quantity: 1, unitPrice: 250 },
    ],
    customerInfo: { firstName: 'Test', lastName: 'Client', phone: '0612345678',
      address: '15 Rue de la Paix', postalCode: '62800', city: 'Lievin', notes: 'Code 1234' }
  };
  if (alreadyPrinted(id)) return res.send('Doublon');
  const ok = await addToQueue(order);
  res.send(ok ? 'OK' : 'ERREUR');
});

app.get('/', (req, res) => res.send(`<h1>DWICH62</h1><p>OK</p><a href="/test">Test</a>`));

app.listen(PORT, () => console.log(`DWICH62 Printer - Port ${PORT}`));
