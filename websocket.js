const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Validate environment variables
if (!supabaseUrl || !supabaseKey) {
    console.error('Error: SUPABASE_URL and SUPABASE_KEY environment variables must be set');
    process.exit(1);
}

console.log('Connecting to Supabase at:', supabaseUrl);
const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize WebSocket server
const port = process.env.WS_PORT || 3001;
const server = new WebSocket.Server({ port });

// Store connected clients to broadcast updates
const clients = new Set();

// Set up Supabase Realtime subscriptions
setupRealtimeSubscriptions();

function setupRealtimeSubscriptions() {
    console.log('Setting up Supabase Realtime subscriptions...');
    
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
        console.log(`Setting up subscription for table: ${tableName}`);
        
        const subscription = supabase
            .channel(`${tableName}-changes`)
            .on('postgres_changes', {
                event: '*', // Listen for all events (INSERT, UPDATE, DELETE)
                schema: 'public',
                table: tableName
            }, (payload) => {
                console.log(`Realtime change detected on ${tableName}:`, payload);
                
                // Broadcast the change to all connected clients
                broadcastDatabaseChange(tableName, payload.eventType, payload.new || payload.old, payload.old);
            })
            .subscribe((status) => {
                console.log(`Realtime subscription status for ${tableName}:`, status);
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
    
    console.log(`Broadcasting ${eventType} event for ${table} to ${clients.size} clients`);
    
    // Send to all connected clients
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

server.on('connection', (socket) => {
    console.log('Yeni bir istemci bağlandı.');
    
    // Add to clients set
    clients.add(socket);

    // Send welcome message
    socket.send(JSON.stringify({ 
        status: 'connected',
        message: 'WebSocket sunucusuna bağlandınız.'
    }));

    socket.on('message', async (message) => {
        let messageData;
        
        try {
            console.log(`İstemciden gelen mesaj: ${message}`);
            
            // Parse the message
            try {
                messageData = JSON.parse(message);
                
                // Handle database operations
                if (messageData.operation && messageData.table) {
                    await handleDatabaseOperation(socket, messageData);
                } else {
                    // Simple hello message
                    console.log('Basit mesaj alındı:', messageData);
                    socket.send(JSON.stringify({ 
                        status: 'success',
                        message: 'Mesaj alındı',
                        operationId: messageData.operationId
                    }));
                }
            } catch (parseError) {
                console.error('JSON parse error:', parseError);
                socket.send(JSON.stringify({ 
                    status: 'error', 
                    success: false,
                    error: 'Geçersiz JSON formatı',
                    operationId: messageData?.operationId
                }));
            }
        } catch (error) {
            console.error('Error processing message:', error);
            socket.send(JSON.stringify({ 
                status: 'error',
                success: false,
                error: `İşlem sırasında bir hata oluştu: ${error.message}`,
                operationId: messageData?.operationId
            }));
        }
    });

    socket.on('close', () => {
        console.log('İstemci bağlantıyı kapattı.');
        // Remove from clients set
        clients.delete(socket);
    });
});

async function handleDatabaseOperation(socket, message) {
    const { operation, table, operationId } = message;
    // data parametresini let olarak tanımlayalım, böylece değerini değiştirebiliriz
    let data = message.data;
   
    console.log(`${operation.toUpperCase()} işlemi, tablo: ${table}`);
    
    try {
        let response = {
            status: 'success',
            success: false,
            operationId
        };

        // Supabase her zaman public şemasını kullanır
        console.log(`Using table: ${table} in public schema`);
        
        // Get the Supabase query builder for the table
        const supabaseTable = supabase.from(table);
        
        switch (operation.toLowerCase()) {
            case 'insert':
                console.log('Insert data:', JSON.stringify(data, null, 2));
                
                // Remove schema field from data if it exists to avoid conflicts
                if (data.schema) {
                    console.log('Removing schema field from data to avoid conflicts');
                    const { schema: _, ...dataWithoutSchema } = data;
                    data = dataWithoutSchema;
                }
                
                try {
                    console.log(`Executing insert into ${table}`);
                    const insertResult = await supabaseTable.insert(data);
                    
                    console.log('Insert result:', JSON.stringify(insertResult, null, 2));
                    
                    if (insertResult.error) {
                        console.error('Insert error details:', insertResult.error);
                        throw new Error(insertResult.error.message || 'Unknown insert error');
                    }
                    
                    response.success = true;
                    response.affectedRows = insertResult.data?.length || 0;
                    response.insertId = insertResult.data?.[0]?.id;
                } catch (insertError) {
                    console.error('Insert operation failed with error:', insertError);
                    console.error('Full error object:', JSON.stringify(insertError, null, 2));
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
                    console.error('Update error details:', updateResult.error);
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
                    console.error('Delete error details:', deleteResult.error);
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
                    console.error('Select error details:', selectResult.error);
                    throw new Error(selectResult.error.message || 'Unknown select error');
                }
                
                response.success = true;
                response.data = selectResult.data;
                break;
                
            default:
                throw new Error(`Desteklenmeyen işlem: ${operation}`);
        }
        
        console.log(`İşlem başarılı: ${operation}, yanıt:`, response);
        socket.send(JSON.stringify(response));
        
    } catch (error) {
        console.error(`${operation} işlemi sırasında hata:`, error);
        
        // Log the full error object for debugging
        console.error('Error details:', {
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
            operationId
        };
        
        socket.send(JSON.stringify(errorResponse));
    }
}

console.log(`WebSocket sunucusu ${port} portunda çalışıyor...`);