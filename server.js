/**
 * DWICH62 - Serveur d'impression automatique
 * Version avec polling Firebase/Supabase-free (utilise un fichier JSON en ligne)
 */

const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// Configuration
const PRINTER_NAME = 'AURES ODP333';
const PORT = 3333;
const SECRET_KEY = process.env.PRINTER_SECRET || 'dwich62-secret-2024';

// File pour stocker les commandes en attente (mode local)
const PENDING_FILE = path.join(__dirname, 'pending_orders.json');

// ============ GÉNÉRATION DES TICKETS ============

function generateKitchenTicket(order) {
  const lines = [];
  const width = 42;
  const center = (text) => ' '.repeat(Math.max(0, Math.floor((width - text.length) / 2))) + text;
  const line = () => '='.repeat(width);
  const dashed = () => '-'.repeat(width);

  lines.push(line());
  lines.push(center('DWICH62 - CUISINE'));
  lines.push(line());
  lines.push('');
  lines.push(center(`COMMANDE #${order.orderId}`));
  lines.push(center(formatDate(order.createdAt)));
  lines.push('');
  lines.push(dashed());
  
  const modeIcon = order.orderType === 'delivery' ? '>>> LIVRAISON <<<' : '>>> SUR PLACE <<<';
  lines.push(center(modeIcon));
  lines.push(dashed());
  lines.push('');

  // Produits SANS PRIX
  order.items.forEach(item => {
    lines.push(`  ${item.quantity || item.qty}x ${item.name}`);
    const desc = item.description || item.options || '';
    if (desc) {
      desc.split(',').forEach(opt => {
        if (opt.trim()) lines.push(`     -> ${opt.trim()}`);
      });
    }
    lines.push('');
  });

  lines.push(dashed());

  if (order.customerInfo?.notes || order.notes) {
    lines.push('');
    lines.push(`  NOTES: ${order.customerInfo?.notes || order.notes}`);
    lines.push('');
  }

  lines.push(dashed());
  const firstName = order.customerInfo?.firstName || order.customerName?.split(' ')[0] || '';
  const lastName = order.customerInfo?.lastName || order.customerName?.split(' ')[1] || '';
  const phone = order.customerInfo?.phone || order.customerPhone || '';
  
  lines.push(`  Client: ${firstName} ${lastName}`);
  lines.push(`  Tel: ${phone}`);
  
  if (order.orderType === 'delivery') {
    const address = order.customerInfo?.address || order.customerAddress || '';
    const postal = order.customerInfo?.postalCode || '';
    const city = order.customerInfo?.city || '';
    lines.push('');
    lines.push(`  ADRESSE:`);
    if (address) lines.push(`  ${address}`);
    if (postal || city) lines.push(`  ${postal} ${city}`);
  }

  lines.push('');
  lines.push(line());
  lines.push('\n\n\n');

  return lines.join('\n');
}

function generateCashierTicket(order) {
  const lines = [];
  const width = 42;
  const center = (text) => ' '.repeat(Math.max(0, Math.floor((width - text.length) / 2))) + text;
  const line = () => '='.repeat(width);
  const dashed = () => '-'.repeat(width);
  const priceRow = (label, price) => {
    const priceStr = formatPrice(price);
    const spaces = Math.max(1, width - label.length - priceStr.length);
    return label + ' '.repeat(spaces) + priceStr;
  };

  lines.push(line());
  lines.push(center('DWICH62'));
  lines.push(center('135 Ter Rue Jules Guesde'));
  lines.push(center('62800 Lievin'));
  lines.push(center('Tel: 07 67 46 95 02'));
  lines.push(line());
  lines.push('');
  lines.push(center(`COMMANDE #${order.orderId}`));
  lines.push(center(formatDate(order.createdAt)));
  lines.push('');
  lines.push(dashed());
  lines.push(center(order.orderType === 'delivery' ? '>>> LIVRAISON <<<' : '>>> SUR PLACE <<<'));
  lines.push(dashed());
  lines.push('');

  // Produits AVEC PRIX
  let subtotal = 0;
  order.items.forEach(item => {
    const qty = item.quantity || item.qty || 1;
    const price = item.unitPrice || item.price || 0;
    const itemTotal = price * qty;
    subtotal += itemTotal;
    
    lines.push(priceRow(`${qty}x ${item.name}`, itemTotal));
    const desc = item.description || item.options || '';
    if (desc) {
      lines.push(`   ${desc.substring(0, 38)}`);
    }
  });

  lines.push('');
  lines.push(dashed());
  lines.push(priceRow('Sous-total', subtotal));
  
  const deliveryFee = order.orderType === 'delivery' ? 500 : 0;
  if (deliveryFee > 0) {
    lines.push(priceRow('Livraison', deliveryFee));
  }
  
  lines.push(dashed());
  lines.push('');
  
  const total = order.totalAmount || order.total || (subtotal + deliveryFee);
  lines.push(center(`TOTAL: ${formatPrice(total)}`));
  lines.push('');
  lines.push(dashed());
  
  // MODE DE PAIEMENT DÉTAILLÉ
  lines.push('');
  if (order.paymentMethod === 'card' || order.paymentMethod === 'stripe') {
    lines.push(center('*** PAYE PAR CARTE ***'));
    lines.push(center('Paiement Stripe recu'));
  } else if (order.paymentMethod === 'cash') {
    lines.push(center('!!! A ENCAISSER !!!'));
    lines.push(center('ESPECES AU LIVREUR'));
    lines.push('');
    lines.push(center(`Montant: ${formatPrice(total)}`));
  } else {
    lines.push(center('!!! A ENCAISSER !!!'));
    lines.push(center('PAIEMENT SUR PLACE'));
    lines.push('');
    lines.push(center(`Montant: ${formatPrice(total)}`));
  }
  lines.push('');
  
  // INFOS CLIENT
  lines.push(dashed());
  lines.push('  CLIENT:');
  const firstName = order.customerInfo?.firstName || order.customerName?.split(' ')[0] || '';
  const lastName = order.customerInfo?.lastName || order.customerName?.split(' ')[1] || '';
  const phone = order.customerInfo?.phone || order.customerPhone || '';
  const email = order.customerInfo?.email || order.customerEmail || '';
  
  lines.push(`  Nom: ${firstName} ${lastName}`);
  lines.push(`  Tel: ${phone}`);
  if (email) lines.push(`  Email: ${email}`);
  
  // ADRESSE LIVRAISON (si livraison)
  if (order.orderType === 'delivery') {
    lines.push('');
    lines.push(dashed());
    lines.push('  ADRESSE LIVRAISON:');
    const address = order.customerInfo?.address || order.customerAddress || '';
    const postal = order.customerInfo?.postalCode || '';
    const city = order.customerInfo?.city || '';
    if (address) lines.push(`  ${address}`);
    if (postal || city) lines.push(`  ${postal} ${city}`);
  }
  
  // NOTES
  if (order.customerInfo?.notes || order.notes) {
    lines.push('');
    lines.push(dashed());
    lines.push(`  NOTES: ${order.customerInfo?.notes || order.notes}`);
  }

  lines.push('');
  lines.push(line());
  lines.push(center('Merci de votre visite !'));
  lines.push(line());
  lines.push('\n\n\n');

  return lines.join('\n');
}

function formatPrice(cents) {
  return (cents / 100).toFixed(2).replace('.', ',') + ' EUR';
}

function formatDate(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  return d.toLocaleString('fr-FR', { 
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// ============ IMPRESSION WINDOWS ============

async function printText(text) {
  return new Promise((resolve, reject) => {
    const tempFile = path.join(__dirname, `ticket_${Date.now()}.txt`);
    
    // Convertir en encodage Windows
    fs.writeFileSync(tempFile, text, { encoding: 'latin1' });
    
    // Méthode 1: Impression directe via PowerShell
    const cmd = `powershell -Command "Get-Content '${tempFile}' | Out-Printer '${PRINTER_NAME}'"`;
    
    exec(cmd, { timeout: 10000 }, (error, stdout, stderr) => {
      // Nettoyer
      setTimeout(() => {
        try { fs.unlinkSync(tempFile); } catch (e) {}
      }, 1000);
      
      if (error) {
        console.error('Erreur PowerShell, tentative alternative...');
        // Méthode 2: Via notepad (fallback)
        exec(`notepad /p "${tempFile}"`, (err2) => {
          if (err2) reject(err2);
          else resolve(true);
        });
      } else {
        resolve(true);
      }
    });
  });
}

async function printOrder(order) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`📦 IMPRESSION COMMANDE #${order.orderId}`);
  console.log(`${'='.repeat(50)}`);
  
  try {
    const kitchenTicket = generateKitchenTicket(order);
    const cashierTicket = generateCashierTicket(order);
    
    console.log('🖨️  Ticket CUISINE...');
    await printText(kitchenTicket);
    
    // Petit délai entre les impressions
    await new Promise(r => setTimeout(r, 500));
    
    console.log('🖨️  Ticket CAISSE...');
    await printText(cashierTicket);
    
    console.log('✅ Impression terminée!\n');
    return true;
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    return false;
  }
}

// ============ API ENDPOINTS ============

// Recevoir une commande à imprimer
app.post('/print', async (req, res) => {
  const { secret, order } = req.body;
  
  if (secret !== SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!order) {
    return res.status(400).json({ error: 'Missing order' });
  }
  
  const success = await printOrder(order);
  res.json({ success, orderId: order.orderId });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', printer: PRINTER_NAME });
});

// Test
app.get('/test', async (req, res) => {
  const testOrder = {
    orderId: 'TEST' + Date.now().toString(36).toUpperCase().slice(-4),
    orderType: 'delivery',
    paymentMethod: 'card',
    totalAmount: 2550,
    createdAt: new Date().toISOString(),
    items: [
      { name: 'Tacos XL', quantity: 2, unitPrice: 900, description: 'Poulet, Cordon bleu' },
      { name: 'Burger Classic', quantity: 1, unitPrice: 750 },
    ],
    customerInfo: {
      firstName: 'Test', lastName: 'Client',
      phone: '0600000000',
      address: '123 Rue Test', postalCode: '62800', city: 'Lievin',
      notes: 'TEST IMPRESSION'
    }
  };
  
  const success = await printOrder(testOrder);
  res.json({ success, message: success ? 'Tickets imprimes!' : 'Erreur impression' });
});

// Page d'accueil simple
app.get('/', (req, res) => {
  res.send(`
    <html>
    <head><title>DWICH62 Printer</title></head>
    <body style="font-family: Arial; padding: 40px; background: #1a1a1a; color: white;">
      <h1>🖨️ DWICH62 - Serveur d'impression</h1>
      <p>Status: <span style="color: #10b981;">● En ligne</span></p>
      <p>Imprimante: <strong>${PRINTER_NAME}</strong></p>
      <hr>
      <a href="/test" style="color: #10b981;">Imprimer un ticket de test</a>
    </body>
    </html>
  `);
});

// ============ DÉMARRAGE ============

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🖨️  DWICH62 - Serveur d'impression                     ║
║                                                          ║
║   Imprimante: ${PRINTER_NAME.padEnd(38)}  ║
║   Adresse:    http://localhost:${PORT}                     ║
║                                                          ║
║   ✅ Serveur prêt - En attente de commandes...           ║
║                                                          ║
║   📋 Test: http://localhost:${PORT}/test                   ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);
});
