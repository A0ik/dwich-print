/**
 * DWICH62 - Serveur d'impression
 * Tickets compacts, pleine largeur
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

function prix(cents) { return (cents / 100).toFixed(2).replace('.', ','); }

function dateHeure(d) {
  const x = d ? new Date(d) : new Date();
  return x.toLocaleDateString('fr-FR') + ' ' + x.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
}

// ============ TICKET CUISINE ============
function ticketCuisine(order) {
  let t = '\n';
  t += '            *** CUISINE ***\n\n';
  t += order.orderType === 'delivery' ? '              LIVRAISON\n\n' : '             SUR PLACE\n\n';
  
  order.items.forEach(item => {
    const qty = item.quantity || item.qty || 1;
    t += `${qty}x ${item.name.toUpperCase()}\n`;
    const desc = item.description || item.options || '';
    if (desc) desc.split(',').forEach(o => { if(o.trim()) t += `   ${o.trim()}\n`; });
  });
  
  t += `\n========== N°${order.orderId} ==========\n\n`;
  
  const nom = `${order.customerInfo?.firstName || ''} ${order.customerInfo?.lastName || ''}`.trim();
  t += `${nom}  ${order.customerInfo?.phone || ''}\n`;
  if (order.orderType === 'delivery') {
    t += `${order.customerInfo?.address || ''}\n`;
    t += `${order.customerInfo?.postalCode || ''} ${order.customerInfo?.city || ''}\n`;
  }
  if (order.customerInfo?.notes) t += `>>> ${order.customerInfo.notes} <<<\n`;
  
  t += '\n\n';
  return t;
}

// ============ TICKET CAISSE ============
function ticketCaisse(order) {
  let t = '\n';
  t += '               DWICH 62\n';
  t += '       135 ter Rue Jules Guesde\n';
  t += '    62800 LIEVIN  07 67 46 95 02\n\n';
  t += `N°${order.orderId}  ${dateHeure(order.createdAt)}\n\n`;
  
  let subtotal = 0;
  order.items.forEach(item => {
    const qty = item.quantity || item.qty || 1;
    const p = item.unitPrice || item.price || 0;
    const tot = p * qty;
    subtotal += tot;
    const nom = `${qty}x ${item.name}`;
    t += `${nom.padEnd(30)}${prix(tot)}\n`;
    const desc = item.description || item.options || '';
    if (desc) t += `   ${desc}\n`;
  });
  
  const livr = order.orderType === 'delivery' ? 500 : 0;
  if (livr) t += `${'Livraison'.padEnd(30)}${prix(livr)}\n`;
  
  const total = order.totalAmount || (subtotal + livr);
  t += `\n============ TOTAL: ${prix(total)} EUR ============\n\n`;
  
  if (order.paymentMethod === 'card' || order.paymentMethod === 'stripe') {
    t += '             PAYE PAR CB\n';
  } else {
    t += '           *** A ENCAISSER ***\n';
    t += order.paymentMethod === 'cash' ? '            ESPECES LIVREUR\n' : '             ESPECES SUR PLACE\n';
  }
  
  t += '\n';
  if (order.orderType === 'delivery') {
    const nom = `${order.customerInfo?.firstName || ''} ${order.customerInfo?.lastName || ''}`.trim();
    t += `${nom}  ${order.customerInfo?.phone || ''}\n`;
    t += `${order.customerInfo?.address || ''}\n`;
    t += `${order.customerInfo?.postalCode || ''} ${order.customerInfo?.city || ''}\n`;
  }
  if (order.customerInfo?.notes) t += `Note: ${order.customerInfo.notes}\n`;
  
  t += '\n          Merci et a bientot !\n';
  t += '            www.dwich62.fr\n\n';
  return t;
}

// ============ IMPRESSION ============
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
  console.log(`[${new Date().toLocaleTimeString()}] #${order.orderId}...`);
  await printText(ticketCuisine(order));
  await new Promise(r => setTimeout(r, 2000));
  await printText(ticketCaisse(order));
  console.log(`[${new Date().toLocaleTimeString()}] #${order.orderId} OK`);
}

// ============ API ============
app.post('/print', async (req, res) => {
  const { secret, order } = req.body;
  if (secret !== SECRET_KEY) return res.status(401).json({ error: 'Unauthorized' });
  if (!order?.orderId) return res.status(400).json({ error: 'Missing order' });
  if (alreadyPrinted(order.orderId)) return res.json({ success: true, duplicate: true });
  const success = await addToQueue(order);
  res.json({ success, orderId: order.orderId });
});

app.get('/health', (req, res) => res.json({ status: 'ok', queue: printQueue.length }));

app.get('/test', async (req, res) => {
  const id = Date.now().toString().slice(-4);
  const order = {
    orderId: id, orderType: 'delivery', paymentMethod: 'cash', totalAmount: 2700,
    createdAt: new Date().toISOString(),
    items: [
      { name: 'Tacos 2 viandes', quantity: 1, unitPrice: 1100, description: 'Merguez, Cordon bleu' },
      { name: 'Double Woping', quantity: 1, unitPrice: 1000, description: 'Hannibal, Nature' },
      { name: 'Coca 33cl', quantity: 1, unitPrice: 100 },
    ],
    customerInfo: { 
      firstName: 'Mohamed', lastName: 'Dupont', phone: '06 12 34 56 78',
      address: '15 Rue de la Paix', postalCode: '62800', city: 'Lievin', 
      notes: 'Digicode 1234' 
    }
  };
  if (alreadyPrinted(id)) return res.send('Doublon');
  const ok = await addToQueue(order);
  res.send(ok ? 'OK!' : 'ERREUR');
});

app.get('/', (req, res) => res.send('<h1>DWICH62</h1><a href="/test">TEST</a>'));

app.listen(PORT, () => console.log(`DWICH62 Printer - Port ${PORT}`));
