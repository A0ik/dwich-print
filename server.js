/**
 * DWICH62 - Serveur d'impression
 * Utilise pdf-to-printer avec fichier texte brut
 */

const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { print } = require('pdf-to-printer');

const app = express();
app.use(express.json());

const PRINTER_NAME = 'AURES ODP333';
const PORT = 3333;
const SECRET_KEY = process.env.PRINTER_SECRET || 'dwich62-secret-2024';
const W = 48; // Largeur 48 caractères pour 80mm

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

// Helpers
const prix = (cents) => (cents / 100).toFixed(2).replace('.', ',');
const center = (txt) => txt.padStart(Math.floor((W + txt.length) / 2)).padEnd(W);
const line = () => '='.repeat(W);
const leftRight = (l, r) => l + ' '.repeat(Math.max(1, W - l.length - r.length)) + r;

// ============ TICKET CUISINE ============
function ticketCuisine(order) {
  let t = '';
  t += center('CUISINE') + '\n';
  t += line() + '\n';
  t += center(order.orderType === 'delivery' ? 'LIVRAISON' : 'SUR PLACE') + '\n';
  t += line() + '\n';
  
  order.items.forEach(item => {
    const qty = item.quantity || item.qty || 1;
    t += `${qty}x ${item.name.toUpperCase()}\n`;
    const desc = item.description || item.options || '';
    if (desc) t += `   ${desc}\n`;
  });
  
  t += line() + '\n';
  t += center(`#${order.orderId}`) + '\n';
  t += line() + '\n';
  
  const nom = `${order.customerInfo?.firstName || ''} ${order.customerInfo?.lastName || ''}`.trim();
  t += `${nom}  ${order.customerInfo?.phone || ''}\n`;
  if (order.orderType === 'delivery') {
    t += `${order.customerInfo?.address || ''}\n`;
    t += `${order.customerInfo?.postalCode || ''} ${order.customerInfo?.city || ''}\n`;
  }
  if (order.customerInfo?.notes) t += `>>> ${order.customerInfo.notes} <<<\n`;
  
  t += '\n';
  return t;
}

// ============ TICKET CAISSE ============
function ticketCaisse(order) {
  let t = '';
  t += center('DWICH 62') + '\n';
  t += center('135ter Rue Jules Guesde') + '\n';
  t += center('62800 LIEVIN') + '\n';
  t += center('07 67 46 95 02') + '\n';
  t += line() + '\n';
  t += center(`#${order.orderId}`) + '\n';
  t += line() + '\n';
  
  let subtotal = 0;
  order.items.forEach(item => {
    const qty = item.quantity || item.qty || 1;
    const p = item.unitPrice || item.price || 0;
    subtotal += p * qty;
    t += leftRight(`${qty}x ${item.name}`, prix(p * qty)) + '\n';
  });
  
  t += line() + '\n';
  const livr = order.orderType === 'delivery' ? 500 : 0;
  if (livr) t += leftRight('Livraison', prix(livr)) + '\n';
  
  const total = order.totalAmount || (subtotal + livr);
  t += center(`TOTAL: ${prix(total)} EUR`) + '\n';
  t += line() + '\n';
  
  if (order.paymentMethod === 'card' || order.paymentMethod === 'stripe') {
    t += center('PAYE PAR CB') + '\n';
  } else {
    t += center('*** A ENCAISSER ***') + '\n';
  }
  
  t += line() + '\n';
  if (order.orderType === 'delivery') {
    const nom = `${order.customerInfo?.firstName || ''} ${order.customerInfo?.lastName || ''}`.trim();
    t += `${nom}  ${order.customerInfo?.phone || ''}\n`;
    t += `${order.customerInfo?.address || ''}\n`;
    t += `${order.customerInfo?.postalCode || ''} ${order.customerInfo?.city || ''}\n`;
  }
  if (order.customerInfo?.notes) t += `! ${order.customerInfo.notes}\n`;
  
  t += line() + '\n';
  t += center('Merci a bientot!') + '\n';
  t += '\n';
  return t;
}

// ============ IMPRESSION ============
async function printText(text) {
  return new Promise((resolve, reject) => {
    const f = path.join(__dirname, `ticket_${Date.now()}.txt`);
    fs.writeFileSync(f, text, 'utf8');
    
    // Utilise la commande print de Windows avec le nom d'imprimante
    const cmd = `print /d:"${PRINTER_NAME}" "${f}"`;
    
    exec(cmd, { shell: 'cmd.exe', timeout: 30000 }, (err, stdout, stderr) => {
      setTimeout(() => { try { fs.unlinkSync(f); } catch(e){} }, 3000);
      if (err && !stderr.includes('en cours')) {
        // Fallback: PowerShell
        const ps = `Get-Content "${f}" | Out-Printer -Name "${PRINTER_NAME}"`;
        exec(`powershell -Command "${ps}"`, (err2) => {
          err2 ? reject(err2) : resolve(true);
        });
      } else {
        resolve(true);
      }
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
    orderId: id, orderType: 'delivery', paymentMethod: 'cash', totalAmount: 2200,
    createdAt: new Date().toISOString(),
    items: [
      { name: 'Tacos XL', quantity: 1, unitPrice: 1100, description: 'Merguez, Cordon bleu' },
      { name: 'Coca 33cl', quantity: 2, unitPrice: 250 },
    ],
    customerInfo: { 
      firstName: 'Mohamed', lastName: 'D', phone: '0612345678',
      address: '15 Rue de la Paix', postalCode: '62800', city: 'Lievin', 
      notes: 'Code 1234' 
    }
  };
  if (alreadyPrinted(id)) return res.send('Doublon - relance serveur');
  const ok = await addToQueue(order);
  res.send(ok ? 'OK!' : 'ERREUR');
});

app.get('/', (req, res) => res.send('<h1>DWICH62</h1><a href="/test">TEST</a>'));

app.listen(PORT, () => console.log(`DWICH62 Printer - Port ${PORT}`));
