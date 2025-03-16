const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Loglama için dizin oluşturma
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// Log dosyası oluşturma
const logStream = fs.createWriteStream(path.join(logDir, `websocket-${new Date().toISOString().split('T')[0]}.log`), { flags: 'a' });

// Loglama fonksiyonu
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    // Konsola yazdırma
    console[level === 'error' ? 'error' : 'log'](logMessage);
    if (data) {
        console[level === 'error' ? 'error' : 'log'](data);
    }
    
    // Dosyaya yazdırma
    logStream.write(logMessage + '\n');
    if (data) {
        logStream.write(JSON.stringify(data, null, 2) + '\n');
    }
}

// Process hata yönetimi
process.on('uncaughtException', (error) => {
    log('error', 'Uncaught Exception:', error);
    // Kritik hatalar için e-posta veya bildirim gönderme kodu buraya eklenebilir
});

process.on('unhandledRejection', (reason, promise) => {
    log('error', 'Unhandled Rejection at:', { promise, reason });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    log('info', 'SIGTERM signal received. Closing WebSocket server...');
    closeServer();
});

process.on('SIGINT', () => {
    log('info', 'SIGINT signal received. Closing WebSocket server...');
    closeServer();
});

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Validate environment variables
if (!supabaseUrl || !supabaseKey) {
    log('error', 'Error: SUPABASE_URL and SUPABASE_KEY environment variables must be set');
    process.exit(1);
}

log('info', 'Connecting to Supabase at:', supabaseUrl);
const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize WebSocket server
const port = process.env.WS_PORT || 3001;
const host = process.env.WS_HOST || '0.0.0.0'; // Default to all interfaces for VDS

// WebSocket server options
const serverOptions = {
    port,
    host,
    // Ping/Pong için yapılandırma
    clientTracking: true,
    perMessageDeflate: {
        zlibDeflateOptions: {
            // Sıkıştırma seviyesi
            level: 6,
            // Bellek kullanımını azaltmak için
            memLevel: 7,
        },
        // Sunucu tarafında sıkıştırma
        serverNoContextTakeover: true,
        // İstemci tarafında sıkıştırma
        clientNoContextTakeover: true,
        // Sadece ikili mesajları sıkıştır
        serverMaxWindowBits: 10,
        // Minimum sıkıştırma boyutu
        threshold: 1024
    }
};

const server = new WebSocket.Server(serverOptions);

// Store connected clients to broadcast updates
const clients = new Set();

// Ping/Pong ile bağlantı kontrolü
const pingInterval = setInterval(() => {
    server.clients.forEach((client) => {
        if (client.isAlive === false) {
            log('info', 'Terminating inactive client connection');
            return client.terminate();
        }
        
        client.isAlive = false;
        client.ping(() => {});
    });
}, 30000); // 30 saniyede bir ping gönder

// Server kapatma fonksiyonu
function closeServer() {
    clearInterval(pingInterval);
    
    server.close(() => {
        log('info', 'WebSocket server closed');
        logStream.end();
        process.exit(0);
    });
    
    // 5 saniye içinde kapanmazsa zorla kapat
    setTimeout(() => {
        log('error', 'Forced shutdown after timeout');
        process.exit(1);
    }, 5000);
}

// Set up Supabase Realtime subscriptions
setupRealtimeSubscriptions();

function setupRealtimeSubscriptions() {
    log('info', 'Setting up Supabase Realtime subscriptions...');
    
    // Dinlenecek tabloların listesi
    const tablesToWatch = [
        'laterp_characters',
        'items',
        'inventory',
        'vehicles'
        // Diğer tablolar buraya eklenebilir
    ];
    
    // Her tablo için bir abonelik oluştur
    tablesToWatch.forEach(tableName => {
        log('info', `Setting up subscription for table: ${tableName}`);
        
        const subscription = supabase
            .channel(`${tableName}-changes`)
            .on('postgres_changes', {
                event: '*', // Listen for all events (INSERT, UPDATE, DELETE)
                schema: 'public',
                table: tableName
            }, (payload) => {
                log('info', `Realtime change detected on ${tableName}:`, payload);
                
                // Broadcast the change to all connected clients
                broadcastDatabaseChange(tableName, payload.eventType, payload.new || payload.old, payload.old);
            })
            .subscribe((status) => {
                log('info', `Realtime subscription status for ${tableName}:`, status);
            });
    });
}

function broadcastDatabaseChange(table, eventType, newData, oldData) {
    const message = JSON.stringify({
        type: 'db_change',
        table,
        event: eventType, // 'INSERT', 'UPDATE', or 'DELETE'
        data: newData,
        old_data: oldData,
        timestamp: new Date().toISOString()
    });
    
    log('info', `Broadcasting ${eventType} event for ${table} to ${clients.size} clients`);
    
    // Send to all connected clients
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

server.on('connection', (socket, req) => {
    // IP adresi loglama (güvenlik için)
    const ip = req.socket.remoteAddress;
    log('info', `New client connected from ${ip}`);
    
    // Ping/Pong için hazırlık
    socket.isAlive = true;
    socket.on('pong', () => {
        socket.isAlive = true;
    });
    
    // Add to clients set
    clients.add(socket);

    // Send welcome message
    socket.send(JSON.stringify({ 
        status: 'connected',
        message: 'WebSocket sunucusuna bağlandınız.',
        server_time: new Date().toISOString()
    }));

    socket.on('message', async (message) => {
        let messageData;
        
        try {
            log('info', `Message received from client ${ip}:`, message.toString());
            
            // Parse the message
            try {
                messageData = JSON.parse(message);
                
                // Handle database operations
                if (messageData.operation && messageData.table) {
                    await handleDatabaseOperation(socket, messageData);
                } else {
                    // Simple hello message
                    log('info', 'Simple message received:', messageData);
                    socket.send(JSON.stringify({ 
                        status: 'success',
                        message: 'Mesaj alındı',
                        operationId: messageData.operationId,
                        server_time: new Date().toISOString()
                    }));
                }
            } catch (parseError) {
                log('error', 'JSON parse error:', parseError);
                socket.send(JSON.stringify({ 
                    status: 'error', 
                    success: false,
                    error: 'Geçersiz JSON formatı',
                    operationId: messageData?.operationId,
                    server_time: new Date().toISOString()
                }));
            }
        } catch (error) {
            log('error', 'Error processing message:', error);
            socket.send(JSON.stringify({ 
                status: 'error',
                success: false,
                error: `İşlem sırasında bir hata oluştu: ${error.message}`,
                operationId: messageData?.operationId,
                server_time: new Date().toISOString()
            }));
        }
    });

    socket.on('close', (code, reason) => {
        log('info', `Client ${ip} disconnected. Code: ${code}, Reason: ${reason || 'No reason provided'}`);
        // Remove from clients set
        clients.delete(socket);
    });
    
    socket.on('error', (error) => {
        log('error', `Socket error for client ${ip}:`, error);
    });
});

async function handleDatabaseOperation(socket, message) {
    const { operation, table, operationId } = message;
    // data parametresini let olarak tanımlayalım, böylece değerini değiştirebiliriz
    let data = message.data;
   
    log('info', `${operation.toUpperCase()} operation on table: ${table}`);
    
    try {
        let response = {
            status: 'success',
            success: false,
            operationId,
            server_time: new Date().toISOString()
        };

        // Supabase her zaman public şemasını kullanır
        log('info', `Using table: ${table} in public schema`);
        
        // Get the Supabase query builder for the table
        const supabaseTable = supabase.from(table);
        
        switch (operation.toLowerCase()) {
            case 'insert':
                log('info', 'Insert data:', data);
                
                // Remove schema field from data if it exists to avoid conflicts
                if (data.schema) {
                    log('info', 'Removing schema field from data to avoid conflicts');
                    const { schema: _, ...dataWithoutSchema } = data;
                    data = dataWithoutSchema;
                }
                
                try {
                    log('info', `Executing insert into ${table}`);
                    const insertResult = await supabaseTable.insert(data);
                    
                    log('info', 'Insert result:', insertResult);
                    
                    if (insertResult.error) {
                        log('error', 'Insert error details:', insertResult.error);
                        throw new Error(insertResult.error.message || 'Unknown insert error');
                    }
                    
                    response.success = true;
                    response.affectedRows = insertResult.data?.length || 0;
                    response.insertId = insertResult.data?.[0]?.id;
                } catch (insertError) {
                    log('error', 'Insert operation failed with error:', insertError);
                    log('error', 'Full error object:', JSON.stringify(insertError, null, 2));
                    throw insertError;
                }
                break;
                
            case 'update':
                if (!data.where) {
                    throw new Error('Update işlemi için where koşulu gereklidir');
                }
                
                // Supabase v2 API'de update işlemi
                const updateResult = await supabaseTable
                    .update(data.data)
                    .match(data.where);
                
                if (updateResult.error) {
                    log('error', 'Update error details:', updateResult.error);
                    throw new Error(updateResult.error.message || 'Unknown update error');
                }
                
                response.success = true;
                response.affectedRows = updateResult.data?.length || 0;
                break;
                
            case 'delete':
                if (!data.where) {
                    throw new Error('Delete işlemi için where koşulu gereklidir');
                }
                
                // Supabase v2 API'de delete işlemi
                const deleteResult = await supabaseTable
                    .delete()
                    .match(data.where);
                
                if (deleteResult.error) {
                    log('error', 'Delete error details:', deleteResult.error);
                    throw new Error(deleteResult.error.message || 'Unknown delete error');
                }
                
                response.success = true;
                response.affectedRows = deleteResult.data?.length || 0;
                break;
                
            case 'select':
                let selectQuery = supabaseTable;
                
                // Select specific columns if provided
                if (data.columns && Array.isArray(data.columns) && !data.columns.includes('*')) {
                    selectQuery = selectQuery.select(data.columns.join(','));
                }
                
                // Apply where conditions if provided
                if (data.where) {
                    // Supabase v2 API'de where koşulları farklı uygulanır
                    // Tüm koşulları tek bir nesne olarak geçirelim
                    selectQuery = selectQuery.select('*').match(data.where);
                }
                
                // Apply limit if provided
                if (data.limit) {
                    selectQuery = selectQuery.limit(data.limit);
                }
                
                // Apply offset if provided
                if (data.offset) {
                    selectQuery = selectQuery.offset(data.offset);
                }
                
                const selectResult = await selectQuery;
                
                if (selectResult.error) {
                    log('error', 'Select error details:', selectResult.error);
                    throw new Error(selectResult.error.message || 'Unknown select error');
                }
                
                response.success = true;
                response.data = selectResult.data;
                break;
                
            default:
                throw new Error(`Desteklenmeyen işlem: ${operation}`);
        }
        
        log('info', `Operation successful: ${operation}, response:`, response);
        socket.send(JSON.stringify(response));
        
    } catch (error) {
        log('error', `Error during ${operation} operation:`, error);
        
        // Log the full error object for debugging
        log('error', 'Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack,
            code: error.code,
            details: error.details
        });
        
        const errorResponse = {
            status: 'error',
            success: false,
            error: error.message || 'Unknown error occurred',
            errorCode: error.code,
            operationId,
            server_time: new Date().toISOString()
        };
        
        socket.send(JSON.stringify(errorResponse));
    }
}

// Sunucu başlatıldığında bilgi mesajı
log('info', `WebSocket server running on ${host}:${port}...`);