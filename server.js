/**
 * DWICH62 - Serveur d'impression ESC/POS
 * Texte GROS + GRAS + Anti-doublons + File d'attente
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
  // Initialisation
  INIT: ESC + '@',
  
  // Taille du texte
  NORMAL: GS + '!' + '\x00',           // Taille normale
  DOUBLE_H: GS + '!' + '\x01',          // Double hauteur
  DOUBLE_W: GS + '!' + '\x10',          // Double largeur  
  DOUBLE_HW: GS + '!' + '\x11',         // Double hauteur + largeur (4x plus gros)
  TRIPLE: GS + '!' + '\x22',            // Triple (encore plus gros)
  
  // Style
  BOLD_ON: ESC + 'E' + '\x01',          // Gras activé
  BOLD_OFF: ESC + 'E' + '\x00',         // Gras désactivé
  
  // Alignement
  LEFT: ESC + 'a' + '\x00',
  CENTER: ESC + 'a' + '\x01',
  RIGHT: ESC + 'a' + '\x02',
  
  // Intensité impression (plus foncé)
  DENSITY_DARK: GS + '|' + '\x07',      // Maximum
  
  // Coupe papier
  CUT: GS + 'V' + '\x00',               // Coupe totale
  CUT_PARTIAL: GS + 'V' + '\x01',       // Coupe partielle
  
  // Saut de ligne
  FEED: ESC + 'd' + '\x02',             // 2 lignes
};

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

// ============ TICKET CUISINE (GROS) ============
function generateKitchenTicket(order) {
  let t = '';
  
  // Init + Densité max
  t += CMD.INIT;
  t += CMD.DENSITY_DARK;
  
  // === HEADER CUISINE ===
  t += CMD.CENTER;
  t += CMD.DOUBLE_HW + CMD.BOLD_ON;
  t += '*** CUISINE ***\n';
  t += CMD.BOLD_OFF + CMD.NORMAL;
  
  t += '================================\n';
  
  // Numéro commande TRES GROS
  t += CMD.TRIPLE + CMD.BOLD_ON;
  t += `#${order.orderId}\n`;
  t += CMD.BOLD_OFF + CMD.DOUBLE_HW;
  t += `${formatTime(order.createdAt)}\n`;
  t += CMD.NORMAL;
  
  t += '================================\n';
  
  // Mode LIVRAISON ou SUR PLACE
  t += CMD.DOUBLE_HW + CMD.BOLD_ON;
  if (order.orderType === 'delivery') {
    t += '>>> LIVRAISON <<<\n';
  } else {
    t += '>>> SUR PLACE <<<\n';
  }
  t += CMD.BOLD_OFF + CMD.NORMAL;
  
  t += '================================\n';
  
  // Produits en GROS
  t += CMD.LEFT;
  t += CMD.DOUBLE_H + CMD.BOLD_ON;
  
  order.items.forEach(item => {
    const qty = item.quantity || item.qty || 1;
    t += `${qty}x ${item.name}\n`;
    t += CMD.BOLD_OFF + CMD.DOUBLE_H;
    const desc = item.description || item.options || '';
    if (desc) {
      desc.split(',').forEach(o => {
        if (o.trim()) t += `   > ${o.trim()}\n`;
      });
    }
    t += CMD.BOLD_ON;
  });
  
  t += CMD.BOLD_OFF + CMD.NORMAL;
  t += '================================\n';
  
  // Notes en gras
  if (order.customerInfo?.notes || order.notes) {
    t += CMD.DOUBLE_H + CMD.BOLD_ON;
    t += `NOTE: ${order.customerInfo?.notes || order.notes}\n`;
    t += CMD.BOLD_OFF + CMD.NORMAL;
    t += '--------------------------------\n';
  }
  
  // Client
  t += CMD.DOUBLE_H;
  const name = `${order.customerInfo?.firstName || ''} ${order.customerInfo?.lastName || ''}`.trim();
  t += `${name}\n`;
  t += `Tel: ${order.customerInfo?.phone || ''}\n`;
  
  if (order.orderType === 'delivery') {
    t += CMD.BOLD_ON;
    t += `${order.customerInfo?.address || ''}\n`;
    t += `${order.customerInfo?.postalCode || ''} ${order.customerInfo?.city || ''}\n`;
    t += CMD.BOLD_OFF;
  }
  
  t += CMD.NORMAL;
  t += '================================\n';
  
  // Coupe
  t += CMD.FEED;
  t += CMD.CUT_PARTIAL;
  
  return t;
}

// ============ TICKET CAISSE (PRO) ============
function generateCashierTicket(order) {
  let t = '';
  
  // Init + Densité max
  t += CMD.INIT;
  t += CMD.DENSITY_DARK;
  
  // === HEADER ===
  t += CMD.CENTER;
  t += '================================\n';
  t += CMD.DOUBLE_HW + CMD.BOLD_ON;
  t += 'DWICH62\n';
  t += CMD.BOLD_OFF + CMD.NORMAL;
  t += '135 Ter Rue Jules Guesde\n';
  t += '62800 LIEVIN\n';
  t += 'Tel: 07 67 46 95 02\n';
  t += '================================\n';
  
  // Numéro commande GROS
  t += CMD.DOUBLE_HW + CMD.BOLD_ON;
  t += `#${order.orderId}\n`;
  t += CMD.BOLD_OFF + CMD.NORMAL;
  t += `${formatDate(order.createdAt)} - ${formatTime(order.createdAt)}\n`;
  
  // Mode
  t += CMD.DOUBLE_H + CMD.BOLD_ON;
  if (order.orderType === 'delivery') {
    t += 'LIVRAISON\n';
  } else {
    t += 'SUR PLACE\n';
  }
  t += CMD.BOLD_OFF + CMD.NORMAL;
  
  t += '--------------------------------\n';
  
  // Produits
  t += CMD.LEFT;
  let subtotal = 0;
  
  order.items.forEach(item => {
    const qty = item.quantity || item.qty || 1;
    const price = item.unitPrice || item.price || 0;
    const tot = price * qty;
    subtotal += tot;
    
    t += CMD.DOUBLE_H;
    const line = `${qty}x ${item.name}`;
    const priceStr = formatPrice(tot);
    const spaces = 24 - line.length - priceStr.length;
    t += line + ' '.repeat(Math.max(1, spaces)) + priceStr + '\n';
    
    t += CMD.NORMAL;
    const desc = item.description || item.options || '';
    if (desc) t += `  ${desc.substring(0, 30)}\n`;
  });
  
  t += '--------------------------------\n';
  
  // Totaux
  t += CMD.DOUBLE_H;
  const del = order.orderType === 'delivery' ? 500 : 0;
  
  const st = 'Sous-total:';
  const stv = formatPrice(subtotal);
  t += st + ' '.repeat(24 - st.length - stv.length) + stv + '\n';
  
  if (del > 0) {
    const dl = 'Livraison:';
    const dlv = formatPrice(del);
    t += dl + ' '.repeat(24 - dl.length - dlv.length) + dlv + '\n';
  }
  
  t += CMD.NORMAL;
  t += '================================\n';
  
  // TOTAL GROS
  t += CMD.CENTER;
  t += CMD.TRIPLE + CMD.BOLD_ON;
  const total = order.totalAmount || (subtotal + del);
  t += `${formatPrice(total)} EUR\n`;
  t += CMD.BOLD_OFF + CMD.NORMAL;
  
  t += '================================\n';
  
  // Paiement
  t += CMD.DOUBLE_HW + CMD.BOLD_ON;
  if (order.paymentMethod === 'card' || order.paymentMethod === 'stripe') {
    t += 'PAYE PAR CB\n';
  } else if (order.paymentMethod === 'cash') {
    t += 'A ENCAISSER\n';
    t += 'ESPECES LIVREUR\n';
  } else {
    t += 'A ENCAISSER\n';
    t += 'SUR PLACE\n';
  }
  t += CMD.BOLD_OFF + CMD.NORMAL;
  
  t += '--------------------------------\n';
  
  // Client
  t += CMD.LEFT + CMD.DOUBLE_H;
  const cname = `${order.customerInfo?.firstName || ''} ${order.customerInfo?.lastName || ''}`.trim();
  t += `Client: ${cname}\n`;
  t += `Tel: ${order.customerInfo?.phone || ''}\n`;
  
  if (order.orderType === 'delivery') {
    t += CMD.BOLD_ON;
    t += `${order.customerInfo?.address || ''}\n`;
    t += `${order.customerInfo?.postalCode || ''} ${order.customerInfo?.city || ''}\n`;
    t += CMD.BOLD_OFF;
  }
  
  if (order.customerInfo?.notes || order.notes) {
    t += `Note: ${order.customerInfo?.notes || order.notes}\n`;
  }
  
  t += CMD.NORMAL;
  t += '================================\n';
  t += CMD.CENTER;
  t += 'Merci de votre visite !\n';
  t += 'www.dwich62.fr\n';
  t += '================================\n';
  
  // Coupe
  t += CMD.FEED;
  t += CMD.CUT_PARTIAL;
  
  return t;
}

function formatPrice(cents) { 
  return (cents / 100).toFixed(2).replace('.', ','); 
}
function formatDate(d) { 
  return (d ? new Date(d) : new Date()).toLocaleDateString('fr-FR'); 
}
function formatTime(d) { 
  return (d ? new Date(d) : new Date()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); 
}

// ============ IMPRESSION RAW ============
async function printRaw(data) {
  return new Promise((resolve, reject) => {
    const f = path.join(__dirname, `ticket_${Date.now()}.bin`);
    fs.writeFileSync(f, data, 'binary');
    
    // Méthode 1: Direct via USB/LPT
    exec(`copy /b "${f}" "\\\\%COMPUTERNAME%\\${PRINTER_NAME}"`, { shell: 'cmd.exe' }, (err) => {
      if (err) {
        // Méthode 2: Via PowerShell raw
        const ps = `$bytes = [System.IO.File]::ReadAllBytes('${f}'); ` +
                   `$printer = New-Object System.IO.StreamWriter('\\\\localhost\\${PRINTER_NAME}'); ` +
                   `$printer.Write([System.Text.Encoding]::Default.GetString($bytes)); ` +
                   `$printer.Close()`;
        exec(`powershell -Command "${ps}"`, (err2) => {
          setTimeout(() => { try { fs.unlinkSync(f); } catch(e){} }, 500);
          err2 ? reject(err2) : resolve(true);
        });
      } else {
        setTimeout(() => { try { fs.unlinkSync(f); } catch(e){} }, 500);
        resolve(true);
      }
    });
  });
}

async function printOrder(order) {
  console.log(`[${new Date().toLocaleTimeString()}] Impression #${order.orderId}...`);
  
  // Ticket CUISINE
  await printRaw(generateKitchenTicket(order));
  await new Promise(r => setTimeout(r, 800));
  
  // Ticket CAISSE  
  await printRaw(generateCashierTicket(order));
  
  console.log(`[${new Date().toLocaleTimeString()}] #${order.orderId} OK`);
}

// ============ API ============
app.post('/print', async (req, res) => {
  const { secret, order } = req.body;
  if (secret !== SECRET_KEY) return res.status(401).json({ error: 'Unauthorized' });
  if (!order?.orderId) return res.status(400).json({ error: 'Missing order' });
  
  if (alreadyPrinted(order.orderId)) {
    console.log(`[DOUBLON] #${order.orderId} ignoré`);
    return res.json({ success: true, orderId: order.orderId, duplicate: true });
  }
  
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
      { name: 'Frites Large', quantity: 1, unitPrice: 400 },
    ],
    customerInfo: { 
      firstName: 'Mohamed', lastName: 'Test', phone: '06 12 34 56 78',
      address: '15 Rue de la Paix', postalCode: '62800', city: 'Lievin', 
      notes: 'Digicode 1234' 
    }
  };
  if (alreadyPrinted(id)) return res.send('Doublon ignoré');
  const ok = await addToQueue(order);
  res.send(ok ? 'OK - 2 tickets imprimes!' : 'ERREUR');
});

app.get('/', (req, res) => res.send(`
  <html><body style="font-family:Arial;padding:40px;background:#111;color:#fff">
  <h1>DWICH62 Imprimante</h1>
  <p style="color:#0f0">● EN LIGNE</p>
  <p>File d'attente: ${printQueue.length}</p>
  <a href="/test" style="color:#0f0;font-size:20px">IMPRIMER UN TEST</a>
  </body></html>
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
