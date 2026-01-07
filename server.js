/**
 * DWICH62 - Serveur d'impression thermique
 * Utilise node-thermal-printer pour contrôle total
 */

const express = require('express');
const ThermalPrinter = require('node-thermal-printer').printer;
const PrinterTypes = require('node-thermal-printer').types;

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

// ============ TICKET CUISINE ============
async function printCuisine(order) {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `printer:${PRINTER_NAME}`,
    width: 48,
    characterSet: 'FRANCE',
  });

  printer.alignCenter();
  printer.setTextSize(1, 1);
  printer.bold(true);
  printer.println('CUISINE');
  printer.bold(false);
  printer.drawLine();
  
  printer.setTextSize(1, 1);
  printer.bold(true);
  printer.println(order.orderType === 'delivery' ? 'LIVRAISON' : 'SUR PLACE');
  printer.bold(false);
  printer.drawLine();
  
  printer.alignLeft();
  order.items.forEach(item => {
    const qty = item.quantity || item.qty || 1;
    printer.bold(true);
    printer.println(`${qty}x ${item.name.toUpperCase()}`);
    printer.bold(false);
    const desc = item.description || item.options || '';
    if (desc) printer.println(`  ${desc}`);
  });
  
  printer.drawLine();
  printer.alignCenter();
  printer.setTextSize(1, 1);
  printer.bold(true);
  printer.println(`#${order.orderId}`);
  printer.bold(false);
  
  printer.alignLeft();
  const nom = `${order.customerInfo?.firstName || ''} ${order.customerInfo?.lastName || ''}`.trim();
  printer.println(`${nom} ${order.customerInfo?.phone || ''}`);
  if (order.orderType === 'delivery') {
    printer.println(order.customerInfo?.address || '');
    printer.println(`${order.customerInfo?.postalCode || ''} ${order.customerInfo?.city || ''}`);
  }
  if (order.customerInfo?.notes) {
    printer.bold(true);
    printer.println(`>>> ${order.customerInfo.notes}`);
    printer.bold(false);
  }
  
  printer.cut();
  
  try {
    await printer.execute();
    return true;
  } catch (e) {
    console.error('Erreur cuisine:', e.message);
    return false;
  }
}

// ============ TICKET CAISSE ============
async function printCaisse(order) {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `printer:${PRINTER_NAME}`,
    width: 48,
    characterSet: 'FRANCE',
  });

  printer.alignCenter();
  printer.bold(true);
  printer.println('DWICH 62');
  printer.bold(false);
  printer.println('135ter Rue Jules Guesde');
  printer.println('62800 LIEVIN');
  printer.println('07 67 46 95 02');
  printer.drawLine();
  
  printer.bold(true);
  printer.println(`#${order.orderId}`);
  printer.bold(false);
  printer.drawLine();
  
  printer.alignLeft();
  let subtotal = 0;
  order.items.forEach(item => {
    const qty = item.quantity || item.qty || 1;
    const p = item.unitPrice || item.price || 0;
    subtotal += p * qty;
    printer.leftRight(`${qty}x ${item.name}`, `${prix(p * qty)}`);
  });
  
  const livr = order.orderType === 'delivery' ? 500 : 0;
  if (livr) printer.leftRight('Livraison', prix(livr));
  
  printer.drawLine();
  printer.alignCenter();
  printer.setTextSize(1, 1);
  printer.bold(true);
  const total = order.totalAmount || (subtotal + livr);
  printer.println(`TOTAL: ${prix(total)} EUR`);
  printer.bold(false);
  printer.drawLine();
  
  if (order.paymentMethod === 'card' || order.paymentMethod === 'stripe') {
    printer.println('PAYE CB');
  } else {
    printer.bold(true);
    printer.invert(true);
    printer.println(' A ENCAISSER ');
    printer.invert(false);
    printer.bold(false);
  }
  
  if (order.orderType === 'delivery') {
    printer.drawLine();
    printer.alignLeft();
    const nom = `${order.customerInfo?.firstName || ''} ${order.customerInfo?.lastName || ''}`.trim();
    printer.println(`${nom} ${order.customerInfo?.phone || ''}`);
    printer.println(order.customerInfo?.address || '');
    printer.println(`${order.customerInfo?.postalCode || ''} ${order.customerInfo?.city || ''}`);
  }
  if (order.customerInfo?.notes) {
    printer.bold(true);
    printer.println(`! ${order.customerInfo.notes}`);
    printer.bold(false);
  }
  
  printer.drawLine();
  printer.alignCenter();
  printer.println('Merci a bientot!');
  
  printer.cut();
  
  try {
    await printer.execute();
    return true;
  } catch (e) {
    console.error('Erreur caisse:', e.message);
    return false;
  }
}

async function printOrder(order) {
  console.log(`[${new Date().toLocaleTimeString()}] #${order.orderId}...`);
  await printCuisine(order);
  await new Promise(r => setTimeout(r, 1000));
  await printCaisse(order);
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
