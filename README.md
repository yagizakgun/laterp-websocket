# LATERP WebSocket Server

A WebSocket server for real-time communication with Supabase database, designed to facilitate real-time updates and database operations for the LATERP application.

## Features

- Real-time bidirectional communication using WebSockets
- Supabase Realtime subscriptions for database changes
- Support for database operations (SELECT, INSERT, UPDATE, DELETE)
- Automatic broadcasting of database changes to all connected clients
- Error handling and logging

## Prerequisites

- Node.js (v14 or higher)
- Supabase account with a project set up
- Supabase service role key (for database operations)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yagizakgun/laterp-websocket.git
   cd laterp-websocket
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file based on the `.env.example` template:
   ```bash
   cp .env.example .env
   ```

4. Update the `.env` file with your Supabase credentials:
   ```
   SUPABASE_URL=your_supabase_url_here
   SUPABASE_KEY=your_supabase_service_role_key_here
   WS_PORT=3001
   ```

## Usage

### Starting the Server

Start the WebSocket server:

```bash
npm start
```

For development with auto-restart on file changes:

```bash
npm run dev
```

### Connecting to the WebSocket Server

From a client application, connect to the WebSocket server:

```javascript
const socket = new WebSocket('ws://localhost:3001');

socket.onopen = () => {
  console.log('Connected to WebSocket server');
};

socket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received message:', data);
};

socket.onclose = () => {
  console.log('Disconnected from WebSocket server');
};
```

### Performing Database Operations

You can perform database operations by sending JSON messages to the WebSocket server:

#### SELECT Operation

```javascript
socket.send(JSON.stringify({
  operation: 'select',
  table: 'laterp_characters',
  operationId: 'unique-operation-id',
  data: {
    columns: ['id', 'name', 'level'],
    where: { user_id: 123 },
    limit: 10,
    offset: 0
  }
}));
```

#### INSERT Operation

```javascript
socket.send(JSON.stringify({
  operation: 'insert',
  table: 'laterp_characters',
  operationId: 'unique-operation-id',
  data: {
    name: 'New Character',
    level: 1,
    user_id: 123
  }
}));
```

#### UPDATE Operation

```javascript
socket.send(JSON.stringify({
  operation: 'update',
  table: 'laterp_characters',
  operationId: 'unique-operation-id',
  data: {
    data: { level: 2 },
    where: { id: 456 }
  }
}));
```

#### DELETE Operation

```javascript
socket.send(JSON.stringify({
  operation: 'delete',
  table: 'laterp_characters',
  operationId: 'unique-operation-id',
  data: {
    where: { id: 456 }
  }
}));
```

### Receiving Real-time Updates

When database changes occur, the server will automatically broadcast messages to all connected clients:

```javascript
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (message.type === 'db_change') {
    console.log(`Database change in table ${message.table}:`);
    console.log(`Event type: ${message.event}`);
    console.log('New data:', message.data);
    console.log('Old data:', message.old_data);
    
    // Update your application state based on the change
  }
};
```

## Tables Being Monitored

The server is currently set up to monitor the following tables:

- `laterp_characters`
- `items`
- `inventory`
- `vehicles`

To monitor additional tables, add them to the `tablesToWatch` array in the `setupRealtimeSubscriptions` function.

## License

MIT