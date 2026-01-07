/**
 * DWICH62 - Serveur d'impression
 * Méthode simple avec fichier texte
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

const LINE = '-'.repeat(42);
const ULINE = '_'.repeat(42);

// ============ TICKET CUISINE ============
function generateKitchenTicket(order) {
  let t = '';
  
  t += LINE + '\n';
  t += '              CUISINE\n';
  t += LINE + '\n';
  
  if (order.orderType === 'delivery') {
    t += '             LIVRAISON\n';
  } else {
    t += '            A EMPORTER\n';
  }
  t += LINE + '\n';
  t += '            A PREPARER\n';
  t += LINE + '\n\n';
  
  // Produits
  order.items.forEach(item => {
    const qty = item.quantity || item.qty || 1;
    t += `${qty} ${item.name.toUpperCase()}\n`;
    
    const desc = item.description || item.options || '';
    if (desc) {
      desc.split(',').forEach(o => {
        if (o.trim()) t += `      ${o.trim().toUpperCase()}\n`;
      });
    }
  });
  
  t += '\n' + LINE + '\n\n';
  
  t += `         TICKET N: ${order.orderId}\n`;
  
  if (order.customerInfo?.notes || order.notes) {
    t += `(${order.customerInfo?.notes || order.notes})\n`;
  }
  
  t += '\n';
  const name = `${order.customerInfo?.firstName || ''} ${order.customerInfo?.lastName || ''}`.trim();
  t += `${formatDate(order.createdAt)} a ${formatTime(order.createdAt)}\n`;
  t += `Client: ${name}\n`;
  t += `Tel: ${order.customerInfo?.phone || ''}\n`;
  
  if (order.orderType === 'delivery') {
    t += `${order.customerInfo?.address || ''}\n`;
    t += `${order.customerInfo?.postalCode || ''} ${order.customerInfo?.city || ''}\n`;
  }
  
  t += '\n\n\n';
  
  return t;
}

// ============ TICKET CAISSE ============
function generateCashierTicket(order) {
  let t = '';
  
  t += '\n';
  t += '             DWICH 62\n';
  t += '     135 ter Rue Jules Guesde\n';
  t += '          62800 LIEVIN\n';
  t += '        07 67 46 95 02\n';
  t += LINE + '\n';
  t += `${formatDate(order.createdAt)}  ${formatTime(order.createdAt)}\n`;
  t += LINE + '\n';
  
  t += `TICKET N: ${order.orderId}\n`;
  t += ULINE + '\n';
  
  // Produits
  let subtotal = 0;
  order.items.forEach(item => {
    const qty = item.quantity || item.qty || 1;
    const price = item.unitPrice || item.price || 0;
    const tot = price * qty;
    subtotal += tot;
    
    t += rightAlign(`${qty} ${item.name.toUpperCase()}`, formatPrice(tot)) + '\n';
    
    const desc = item.description || item.options || '';
    if (desc) {
      desc.split(',').forEach(o => {
        if (o.trim()) t += `      ${o.trim().toUpperCase()}\n`;
      });
    }
  });
  
  t += ULINE + '\n';
  
  const deliveryFee = order.orderType === 'delivery' ? 500 : 0;
  if (deliveryFee > 0) {
    t += rightAlign('LIVRAISON', formatPrice(deliveryFee)) + '\n';
    t += ULINE + '\n';
  }
  
  const total = order.totalAmount || (subtotal + deliveryFee);
  t += '\n';
  t += `          TOTAL: ${formatPrice(total)}\n`;
  t += '\n' + LINE + '\n';
  
  if (order.paymentMethod === 'card' || order.paymentMethod === 'stripe') {
    t += rightAlign('Carte Bancaire', formatPrice(total)) + '\n';
  } else if (order.paymentMethod === 'cash') {
    t += '       A ENCAISSER - LIVREUR\n';
    t += rightAlign('Especes', formatPrice(total)) + '\n';
  } else {
    t += '      A ENCAISSER - SUR PLACE\n';
    t += rightAlign('Especes', formatPrice(total)) + '\n';
  }
  
  t += LINE + '\n';
  
  if (order.orderType === 'delivery') {
    t += '            LIVRAISON\n\n';
    const name = `${order.customerInfo?.firstName || ''} ${order.customerInfo?.lastName || ''}`.trim();
    t += `Client: ${name}\n`;
    t += `Tel: ${order.customerInfo?.phone || ''}\n`;
    t += `${order.customerInfo?.address || ''}\n`;
    t += `${order.customerInfo?.postalCode || ''} ${order.customerInfo?.city || ''}\n`;
  } else {
    t += '           A EMPORTER\n';
  }
  
  if (order.customerInfo?.notes || order.notes) {
    t += `\nNote: ${order.customerInfo?.notes || order.notes}\n`;
  }
  
  t += '\n';
  t += '       MERCI DE VOTRE VISITE\n';
  t += '          A TRES BIENTOT\n';
  t += '\n';
  t += '         www.dwich62.fr\n';
  t += '\n\n\n';
  
  return t;
}

// ============ IMPRESSION ============
async function printText(text) {
  return new Promise((resolve, reject) => {
    const f = path.join(__dirname, `ticket_${Date.now()}.txt`);
    fs.writeFileSync(f, text, 'utf8');
    
    // Méthode: notepad /p (impression silencieuse)
    const cmd = `notepad /p "${f}"`;
    
    exec(cmd, { timeout: 30000 }, (err) => {
      setTimeout(() => {
        try { fs.unlinkSync(f); } catch(e){}
      }, 5000);
      
      if (err) {
        reject(err);
      } else {
        resolve(true);
      }
    });
  });
}

async function printOrder(order) {
  console.log(`[${new Date().toLocaleTimeString()}] #${order.orderId}...`);
  
  // Ticket CUISINE
  await printText(generateKitchenTicket(order));
  await new Promise(r => setTimeout(r, 2000));
  
  // Ticket CAISSE
  await printText(generateCashierTicket(order));
  
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
  if (alreadyPrinted(id)) return res.send('Doublon - Relance le serveur pour retester');
  const ok = await addToQueue(order);
  res.send(ok ? 'OK - Tickets imprimes!' : 'ERREUR');
});

app.get('/', (req, res) => res.send(`
  <html>
  <body style="font-family:Arial;padding:40px;background:#1a1a1a;color:white;text-align:center">
    <h1>DWICH62 Printer</h1>
    <p style="color:#10b981">EN LIGNE</p>
    <p>Imprimante: ${PRINTER_NAME}</p>
    <br>
    <a href="/test" style="background:#10b981;color:white;padding:15px 30px;text-decoration:none;border-radius:8px;font-size:18px">IMPRIMER UN TEST</a>
  </body>
  </html>
`));

app.listen(PORT, () => {
  console.log('');
  console.log('================================');
  console.log('  DWICH62 - Serveur Impression');
  console.log('================================');
  console.log(`  Imprimante: ${PRINTER_NAME}`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Test: http://localhost:${PORT}/test`);
  console.log('================================');
  console.log('');
});
