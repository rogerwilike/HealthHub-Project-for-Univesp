const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./firebase-key.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function testarGravacao() {
  try {
    const docRef = await db.collection('lembretes').add({
      telefone: '5519999999999',
      medicamento: 'Paracetamol 500mg',
      horario: '08:00',
      observacoes: 'Teste inicial de conexão',
      criadoEm: new Date()
    });

    console.log('✅ Dado gravado com sucesso! ID do Documento:', docRef.id);
  } catch (error) {
    console.error('❌ Erro ao gravar no Firestore:', error);
  }
}

testarGravacao();