/**
 * DWICH62 - Serveur d'impression
 * Style ticket de caisse professionnel
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

// Anti-doublons
const printedOrders = new Set();
const MAX_HISTORY = 100;

// File d'attente
let printQueue = [];
let isPrinting = false;

// ============ COMMANDES ESC/POS ============
const ESC = '\x1B';
const GS = '\x1D';

const CMD = {
  INIT: ESC + '@',
  
  // Taille
  NORMAL: ESC + '!' + '\x00',
  BOLD: ESC + '!' + '\x08',
  DOUBLE_H: ESC + '!' + '\x10',
  DOUBLE_W: ESC + '!' + '\x20',
  DOUBLE_HW: ESC + '!' + '\x30',
  BOLD_DOUBLE_HW: ESC + '!' + '\x38',
  
  // Alignement
  LEFT: ESC + 'a' + '\x00',
  CENTER: ESC + 'a' + '\x01',
  RIGHT: ESC + 'a' + '\x02',
  
  // Coupe
  CUT: GS + 'V' + '\x00',
  FEED: ESC + 'd' + '\x03',
};

const LINE = '-'.repeat(42);
const DLINE = '='.repeat(42);
const ULINE = '_'.repeat(42);

// ============ HELPERS ============
function alreadyPrinted(orderId) {
  if (printedOrders.has(orderId)) return true;
  printedOrders.add(orderId);
  if (printedOrders.size > MAX_HISTORY) {
    printedOrders.delete(printedOrders.values().next().value);
  }
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

function formatPrice(cents) {
  return (cents / 100).toFixed(2).replace('.', ',') + ' EUR';
}

function formatDate(d) {
  const date = d ? new Date(d) : new Date();
  const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const mois = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
  return `${jours[date.getDay()]} ${date.getDate()} ${mois[date.getMonth()]} ${date.getFullYear()}`;
}

function formatTime(d) {
  return (d ? new Date(d) : new Date()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function rightAlign(left, right, width = 42) {
  const spaces = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(spaces) + right;
}

// ============ TICKET CUISINE (FABRICATION) ============
function generateKitchenTicket(order) {
  let t = CMD.INIT;
  
  t += CMD.CENTER;
  t += LINE + '\n';
  t += CMD.BOLD_DOUBLE_HW;
  t += 'CUISINE\n';
  t += CMD.NORMAL;
  t += LINE + '\n';
  
  // Mode
  t += CMD.BOLD_DOUBLE_HW;
  if (order.orderType === 'delivery') {
    t += 'LIVRAISON\n';
  } else {
    t += 'A EMPORTER\n';
  }
  t += CMD.NORMAL;
  t += LINE + '\n';
  t += CMD.BOLD;
  t += 'A PREPARER\n';
  t += CMD.NORMAL;
  t += LINE + '\n';
  
  // Produits
  t += CMD.LEFT;
  order.items.forEach(item => {
    const qty = item.quantity || item.qty || 1;
    t += CMD.BOLD_DOUBLE_HW;
    t += `${qty} ${item.name.toUpperCase()}\n`;
    t += CMD.NORMAL;
    
    const desc = item.description || item.options || '';
    if (desc) {
      desc.split(',').forEach(o => {
        if (o.trim()) t += `      ${o.trim().toUpperCase()}\n`;
      });
    }
  });
  
  t += '\n';
  t += LINE + '\n';
  
  // Numéro ticket GROS
  t += CMD.CENTER;
  t += CMD.BOLD_DOUBLE_HW;
  t += `TICKET N°: ${order.orderId}\n`;
  t += CMD.NORMAL;
  
  // Notes client
  if (order.customerInfo?.notes || order.notes) {
    t += CMD.BOLD;
    t += `(${order.customerInfo?.notes || order.notes})\n`;
    t += CMD.NORMAL;
  }
  
  t += '\n';
  
  // Date et client
  const name = `${order.customerInfo?.firstName || ''} ${order.customerInfo?.lastName || ''}`.trim();
  t += `${formatDate(order.createdAt)} a ${formatTime(order.createdAt)}\n`;
  t += `Client: ${name}\n`;
  t += `Tel: ${order.customerInfo?.phone || ''}\n`;
  
  if (order.orderType === 'delivery') {
    t += CMD.BOLD;
    t += `${order.customerInfo?.address || ''}\n`;
    t += `${order.customerInfo?.postalCode || ''} ${order.customerInfo?.city || ''}\n`;
    t += CMD.NORMAL;
  }
  
  t += '\n\n';
  t += CMD.FEED + CMD.CUT;
  
  return t;
}

// ============ TICKET CLIENT (CAISSE) ============
function generateCashierTicket(order) {
  let t = CMD.INIT;
  
  // En-tête
  t += CMD.CENTER;
  t += CMD.BOLD_DOUBLE_HW;
  t += 'DWICH 62\n';
  t += CMD.NORMAL;
  t += '135 ter Rue Jules Guesde\n';
  t += '62800 LIEVIN\n';
  t += '07 67 46 95 02\n';
  t += LINE + '\n';
  
  // Date
  t += `${formatDate(order.createdAt)}  ${formatTime(order.createdAt)}\n`;
  t += LINE + '\n';
  
  // Numéro ticket
  t += CMD.BOLD_DOUBLE_HW;
  t += `TICKET N°: ${order.orderId}`;
  t += CMD.NORMAL;
  t += '                    TTC\n';
  t += ULINE + '\n';
  
  // Produits
  t += CMD.LEFT;
  let subtotal = 0;
  
  order.items.forEach(item => {
    const qty = item.quantity || item.qty || 1;
    const price = item.unitPrice || item.price || 0;
    const tot = price * qty;
    subtotal += tot;
    
    t += CMD.BOLD;
    t += rightAlign(`${qty} ${item.name.toUpperCase()}`, formatPrice(tot)) + '\n';
    t += CMD.NORMAL;
    
    const desc = item.description || item.options || '';
    if (desc) {
      desc.split(',').forEach(o => {
        if (o.trim()) t += `           ${o.trim().toUpperCase()}\n`;
      });
    }
  });
  
  t += ULINE + '\n';
  
  // Livraison si applicable
  const deliveryFee = order.orderType === 'delivery' ? 500 : 0;
  if (deliveryFee > 0) {
    t += rightAlign('LIVRAISON', formatPrice(deliveryFee)) + '\n';
    t += ULINE + '\n';
  }
  
  // Total
  const total = order.totalAmount || (subtotal + deliveryFee);
  t += CMD.CENTER;
  t += CMD.BOLD_DOUBLE_HW;
  t += `TOTAL: ${formatPrice(total)}\n`;
  t += CMD.NORMAL;
  t += LINE + '\n';
  
  // Mode de paiement
  if (order.paymentMethod === 'card' || order.paymentMethod === 'stripe') {
    t += rightAlign('Carte Bancaire', formatPrice(total)) + '\n';
  } else if (order.paymentMethod === 'cash') {
    t += CMD.BOLD_DOUBLE_HW;
    t += 'A ENCAISSER - LIVREUR\n';
    t += CMD.NORMAL;
    t += rightAlign('Especes', formatPrice(total)) + '\n';
  } else {
    t += CMD.BOLD_DOUBLE_HW;
    t += 'A ENCAISSER - SUR PLACE\n';
    t += CMD.NORMAL;
    t += rightAlign('Especes', formatPrice(total)) + '\n';
  }
  
  t += LINE + '\n';
  
  // Mode livraison/emporter
  t += CMD.CENTER;
  t += CMD.BOLD_DOUBLE_HW;
  if (order.orderType === 'delivery') {
    t += 'LIVRAISON\n';
    t += CMD.NORMAL;
    t += '\n';
    const name = `${order.customerInfo?.firstName || ''} ${order.customerInfo?.lastName || ''}`.trim();
    t += `Client: ${name}\n`;
    t += `Tel: ${order.customerInfo?.phone || ''}\n`;
    t += CMD.BOLD;
    t += `${order.customerInfo?.address || ''}\n`;
    t += `${order.customerInfo?.postalCode || ''} ${order.customerInfo?.city || ''}\n`;
    t += CMD.NORMAL;
  } else {
    t += 'A EMPORTER\n';
    t += CMD.NORMAL;
  }
  
  // Notes
  if (order.customerInfo?.notes || order.notes) {
    t += '\n';
    t += CMD.BOLD;
    t += `Note: ${order.customerInfo?.notes || order.notes}\n`;
    t += CMD.NORMAL;
  }
  
  t += '\n';
  t += CMD.CENTER;
  t += 'MERCI DE VOTRE VISITE\n';
  t += 'A TRES BIENTOT\n';
  t += '\n';
  t += 'www.dwich62.fr\n';
  t += '\n\n';
  
  t += CMD.FEED + CMD.CUT;
  
  return t;
}

// ============ IMPRESSION ============
async function printRaw(data) {
  return new Promise((resolve, reject) => {
    const f = path.join(__dirname, `t_${Date.now()}.bin`);
    fs.writeFileSync(f, data, 'binary');
    exec(`copy /b "${f}" "\\\\%COMPUTERNAME%\\${PRINTER_NAME}"`, { shell: 'cmd.exe' }, (err) => {
      setTimeout(() => { try { fs.unlinkSync(f); } catch(e){} }, 500);
      err ? reject(err) : resolve(true);
    });
  });
}

async function printOrder(order) {
  console.log(`[${new Date().toLocaleTimeString()}] #${order.orderId}...`);
  await printRaw(generateKitchenTicket(order));
  await new Promise(r => setTimeout(r, 800));
  await printRaw(generateCashierTicket(order));
  console.log(`[${new Date().toLocaleTimeString()}] #${order.orderId} OK`);
}

// ============ API ============
app.post('/print', async (req, res) => {
  const { secret, order } = req.body;
  if (secret !== SECRET_KEY) return res.status(401).json({ error: 'Unauthorized' });
  if (!order?.orderId) return res.status(400).json({ error: 'Missing order' });
  if (alreadyPrinted(order.orderId)) {
    console.log(`[DOUBLON] #${order.orderId}`);
    return res.json({ success: true, duplicate: true });
  }
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
      { name: 'Menu Tacos 2 viandes', quantity: 1, unitPrice: 1100, description: 'Merguez, Cordon bleu, Hannibal, Cheddar' },
      { name: 'Menu Double Woping', quantity: 1, unitPrice: 1000, description: 'Hannibal, Nature' },
      { name: 'Coca Cherry 33cl', quantity: 1, unitPrice: 100 },
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

app.get('/', (req, res) => res.send(`<h1>DWICH62</h1><a href="/test">TEST</a>`));

app.listen(PORT, () => console.log(`DWICH62 Printer - Port ${PORT}`));
