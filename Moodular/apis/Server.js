
// Importar librerías
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
require('dotenv').config();

const { Pool } = require('pg');

const poolConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: true,
    }
};

// Esta es la lógica clave:
// Si detecta la variable de Vercel, la usa.
if (process.env.AIVEN_CA_CERT) {
    poolConfig.ssl.ca = process.env.AIVEN_CA_CERT;
} 
// Si no, busca el archivo local en tu PC.
else {
    poolConfig.ssl.ca = fs.readFileSync(path.join(__dirname, 'ca.pem')).toString();
}

const pool = new Pool(poolConfig);

const createTable = async () => {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS reports (
            id SERIAL PRIMARY KEY,
            description TEXT NOT NULL,
            incident_type VARCHAR(255) NOT NULL,
            address TEXT,
            latitude NUMERIC NOT NULL,
            longitude NUMERIC NOT NULL,
            image_url VARCHAR(255),
            timestamp TIMESTAMPTZ DEFAULT NOW()
        );`;
    try {
        await pool.query(createTableQuery);
        console.log("Tabla 'reports' lista en PostgreSQL.");
    } catch (err) {
        console.error("Error al crear la tabla:", err);
    }
};

// Configuración de la App
const app = express();
const PORT = 3000;

// Middlewares
app.use(cors()); // Esta única línea maneja CORS para todas las solicitudes, incluidas las de verificación
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configuración de Multer
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Endpoint para recibir reportes
app.post('/api/reports', upload.single('incidentImage'), async (req, res) => {
    console.log('📩 Reporte recibido en el servidor.');

    const { description, incidentType, address, latitude, longitude } = req.body;
    let imageUrl = null;

    if (req.file) {
        try {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const filename = `incident-${uniqueSuffix}.webp`;
            const outputPath = path.join('uploads', filename);

            await sharp(req.file.buffer)
                .resize({ width: 1024, fit: 'inside' })
                .webp({ quality: 80 })
                .toFile(outputPath);

            imageUrl = outputPath;
            console.log(`✅ Imagen procesada y guardada en: ${outputPath}`);
        } catch (error) {
            console.error('❌ Error procesando la imagen:', error);
        }
    }

    const sql = `
        INSERT INTO reports (description, incident_type, address, latitude, longitude, image_url)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id;
    `;
    const params = [description, incidentType, address, latitude, longitude, imageUrl];
    console.log('🧩 Parámetros SQL a insertar:', params);

    try {
        const result = await pool.query(sql, params);

        let newId = null;
        if (result.rows && result.rows.length > 0) {
            newId = result.rows[0].id;
            console.log(`🎉 Reporte guardado con ID: ${newId}`);
        } else {
            console.log(`⚠️ Reporte guardado, pero la DB no devolvió el ID.`);
        }

        console.log('✅ Enviando respuesta JSON al cliente...');
        res.status(201).json({ 
            message: 'Reporte guardado exitosamente.',
            reportId: newId 
        });

    } catch (err) {
        console.error("❌ Error CRÍTICO al insertar en la base de datos:", err);
        return res.status(500).json({ message: "Error interno al guardar el reporte." });
    }
});

// Iniciar el servidor
app.listen(PORT, () => {
    if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
    
    pool.query('SELECT NOW()', (err, res) => {
        if (err) {
            console.error("❌ Error al conectar con la base de datos de Aiven:", err);
        } else {
            console.log("✅ Conectado a la base de datos de Aiven:", res.rows[0].now);
            createTable();
        }
    });
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});