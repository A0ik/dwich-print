/**
 * DWICH62 - Serveur d'impression automatique
 * Tickets professionnels - Économie de papier
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

// ============ TICKET CUISINE (sans prix) ============
function generateKitchenTicket(order) {
  const lines = [];
  const w = 42;
  const center = (t) => ' '.repeat(Math.max(0, Math.floor((w - t.length) / 2))) + t;
  const sep = () => '-'.repeat(w);

  lines.push(center('*** CUISINE ***'));
  lines.push(sep());
  lines.push(center(`#${order.orderId}`));
  lines.push(center(formatTime(order.createdAt)));
  lines.push(sep());
  
  // Mode
  const mode = order.orderType === 'delivery' ? 'LIVRAISON' : 'SUR PLACE';
  lines.push(center(`>> ${mode} <<`));
  lines.push(sep());

  // Produits
  order.items.forEach(item => {
    const qty = item.quantity || item.qty || 1;
    lines.push(`${qty}x ${item.name}`);
    const desc = item.description || item.options || '';
    if (desc) {
      desc.split(',').forEach(opt => {
        if (opt.trim()) lines.push(`   > ${opt.trim()}`);
      });
    }
  });

  lines.push(sep());

  // Notes
  if (order.customerInfo?.notes || order.notes) {
    lines.push(`NOTE: ${order.customerInfo?.notes || order.notes}`);
    lines.push(sep());
  }

  // Client
  const name = `${order.customerInfo?.firstName || ''} ${order.customerInfo?.lastName || ''}`.trim();
  const phone = order.customerInfo?.phone || order.customerPhone || '';
  lines.push(`Client: ${name}`);
  lines.push(`Tel: ${phone}`);
  
  if (order.orderType === 'delivery') {
    const addr = order.customerInfo?.address || '';
    const cp = order.customerInfo?.postalCode || '';
    const city = order.customerInfo?.city || '';
    lines.push(`Adr: ${addr}`);
    lines.push(`     ${cp} ${city}`);
  }

  lines.push(sep());
  lines.push('');
  lines.push('');

  return lines.join('\n');
}

// ============ TICKET CAISSE (professionnel) ============
function generateCashierTicket(order) {
  const lines = [];
  const w = 42;
  const center = (t) => ' '.repeat(Math.max(0, Math.floor((w - t.length) / 2))) + t;
  const sep = () => '-'.repeat(w);
  const doubleSep = () => '='.repeat(w);
  const rightAlign = (label, value) => {
    const spaces = Math.max(1, w - label.length - value.length);
    return label + ' '.repeat(spaces) + value;
  };

  // En-tête
  lines.push(doubleSep());
  lines.push(center('DWICH62'));
  lines.push(center('135 Ter Rue Jules Guesde'));
  lines.push(center('62800 LIEVIN'));
  lines.push(center('Tel: 07 67 46 95 02'));
  lines.push(doubleSep());
  
  // Infos commande
  lines.push('');
  lines.push(rightAlign('Commande:', `#${order.orderId}`));
  lines.push(rightAlign('Date:', formatDate(order.createdAt)));
  lines.push(rightAlign('Heure:', formatTime(order.createdAt)));
  lines.push(rightAlign('Mode:', order.orderType === 'delivery' ? 'Livraison' : 'Sur place'));
  lines.push('');
  lines.push(sep());

  // Produits
  lines.push('');
  let subtotal = 0;
  order.items.forEach(item => {
    const qty = item.quantity || item.qty || 1;
    const price = item.unitPrice || item.price || 0;
    const itemTotal = price * qty;
    subtotal += itemTotal;
    
    lines.push(rightAlign(`${qty}x ${item.name}`, formatPrice(itemTotal)));
    const desc = item.description || item.options || '';
    if (desc) {
      lines.push(`   ${desc.substring(0, 38)}`);
    }
  });
  lines.push('');
  lines.push(sep());

  // Totaux
  lines.push(rightAlign('Sous-total:', formatPrice(subtotal)));
  
  const deliveryFee = order.orderType === 'delivery' ? 500 : 0;
  if (deliveryFee > 0) {
    lines.push(rightAlign('Livraison:', formatPrice(deliveryFee)));
  }
  
  lines.push(sep());
  const total = order.totalAmount || order.total || (subtotal + deliveryFee);
  lines.push('');
  lines.push(rightAlign('TOTAL EUR:', formatPrice(total)));
  lines.push('');
  lines.push(doubleSep());

  // Mode de paiement
  lines.push('');
  if (order.paymentMethod === 'card' || order.paymentMethod === 'stripe') {
    lines.push(center('PAYE PAR CARTE BANCAIRE'));
  } else if (order.paymentMethod === 'cash') {
    lines.push(center('** A ENCAISSER **'));
    lines.push(center('ESPECES AU LIVREUR'));
  } else {
    lines.push(center('** A ENCAISSER **'));
    lines.push(center('PAIEMENT SUR PLACE'));
  }
  lines.push('');
  lines.push(sep());

  // Infos client
  lines.push('');
  const name = `${order.customerInfo?.firstName || ''} ${order.customerInfo?.lastName || ''}`.trim();
  const phone = order.customerInfo?.phone || order.customerPhone || '';
  lines.push(`Client: ${name}`);
  lines.push(`Tel: ${phone}`);
  
  // Adresse si livraison
  if (order.orderType === 'delivery') {
    lines.push('');
    lines.push('Adresse de livraison:');
    const addr = order.customerInfo?.address || '';
    const cp = order.customerInfo?.postalCode || '';
    const city = order.customerInfo?.city || '';
    lines.push(`${addr}`);
    lines.push(`${cp} ${city}`);
  }

  // Notes
  if (order.customerInfo?.notes || order.notes) {
    lines.push('');
    lines.push(`Note: ${order.customerInfo?.notes || order.notes}`);
  }

  lines.push('');
  lines.push(doubleSep());
  lines.push(center('Merci de votre visite !'));
  lines.push(center('www.dwich62.fr'));
  lines.push(doubleSep());
  lines.push('');
  lines.push('');

  return lines.join('\n');
}

function formatPrice(cents) {
  return (cents / 100).toFixed(2).replace('.', ',');
}

function formatDate(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  return d.toLocaleDateString('fr-FR');
}

function formatTime(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// ============ IMPRESSION ============
async function printText(text) {
  return new Promise((resolve, reject) => {
    const tempFile = path.join(__dirname, `ticket_${Date.now()}.txt`);
    fs.writeFileSync(tempFile, text, { encoding: 'latin1' });
    
    const cmd = `powershell -Command "Get-Content '${tempFile}' | Out-Printer '${PRINTER_NAME}'"`;
    
    exec(cmd, { timeout: 15000 }, (error) => {
      setTimeout(() => { try { fs.unlinkSync(tempFile); } catch (e) {} }, 1000);
      if (error) reject(error);
      else resolve(true);
    });
  });
}

async function printOrder(order) {
  console.log(`\n${'='.repeat(40)}`);
  console.log(`COMMANDE #${order.orderId}`);
  console.log(`${'='.repeat(40)}`);
  
  try {
    // Ticket CUISINE
    console.log('Impression CUISINE...');
    await printText(generateKitchenTicket(order));
    
    await new Promise(r => setTimeout(r, 300));
    
    // Ticket CAISSE
    console.log('Impression CAISSE...');
    await printText(generateCashierTicket(order));
    
    console.log('OK!\n');
    return true;
  } catch (error) {
    console.error('ERREUR:', error.message);
    return false;
  }
}

// ============ API ============
app.post('/print', async (req, res) => {
  const { secret, order } = req.body;
  if (secret !== SECRET_KEY) return res.status(401).json({ error: 'Unauthorized' });
  if (!order) return res.status(400).json({ error: 'Missing order' });
  
  const success = await printOrder(order);
  res.json({ success, orderId: order.orderId });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', printer: PRINTER_NAME });
});

app.get('/test', async (req, res) => {
  const testOrder = {
    orderId: 'TEST' + Date.now().toString(36).toUpperCase().slice(-4),
    orderType: 'delivery',
    paymentMethod: 'cash',
    totalAmount: 2350,
    createdAt: new Date().toISOString(),
    items: [
      { name: 'Tacos XL', quantity: 2, unitPrice: 900, description: 'Poulet, Cordon bleu, Algerienne' },
      { name: 'Coca-Cola', quantity: 1, unitPrice: 250 },
      { name: 'Frites', quantity: 1, unitPrice: 300 },
    ],
    customerInfo: {
      firstName: 'Mohamed', lastName: 'Test',
      phone: '06 12 34 56 78',
      address: '15 Rue de la Paix', postalCode: '62800', city: 'Lievin',
      notes: 'Digicode 1234'
    }
  };
  
  const success = await printOrder(testOrder);
  res.send(success ? 'OK - Tickets imprimes!' : 'ERREUR - Verifiez l\'imprimante');
});

app.get('/', (req, res) => {
  res.send(`<html><body style="font-family:Arial;padding:40px;background:#111;color:#fff">
    <h1>DWICH62 - Imprimante</h1>
    <p>Status: <span style="color:#0f0">EN LIGNE</span></p>
    <p><a href="/test" style="color:#0f0">Imprimer un test</a></p>
  </body></html>`);
});

app.listen(PORT, () => {
  console.log(`\n${'='.repeat(40)}`);
  console.log('  DWICH62 - Serveur Impression');
  console.log(`${'='.repeat(40)}`);
  console.log(`  Imprimante: ${PRINTER_NAME}`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Test: http://localhost:${PORT}/test`);
  console.log(`${'='.repeat(40)}\n`);
});
