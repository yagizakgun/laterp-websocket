# Ubuntu VDS Üzerinde WebSocket Sunucusu Kurulumu

Bu rehber, LATERP WebSocket sunucusunu Ubuntu VDS (Virtual Dedicated Server) üzerinde kurma ve çalıştırma adımlarını içermektedir.

## Ön Gereksinimler

- Ubuntu 20.04 LTS veya daha yeni bir sürüm
- Root erişimi veya sudo yetkisi
- Açık bir port (varsayılan: 3001)

## Kurulum Adımları

### 1. Sunucuyu Güncelleme

İlk olarak, sunucunuzu güncelleyin:

```bash
sudo apt update
sudo apt upgrade -y
```

### 2. Node.js Kurulumu

Node.js ve npm'i kurun:

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

Node.js sürümünü kontrol edin:

```bash
node -v
npm -v
```

### 3. Git Kurulumu

Git'i kurun:

```bash
sudo apt install git -y
```

### 4. Projeyi Klonlama

Projeyi sunucunuza klonlayın:

```bash
git clone https://github.com/yagizakgun/laterp-websocket.git
cd laterp-websocket
```

### 5. Bağımlılıkları Yükleme

Gerekli npm paketlerini yükleyin:

```bash
npm install
```

### 6. Çevre Değişkenlerini Ayarlama

`.env` dosyasını oluşturun:

```bash
cp .env.example .env
nano .env
```

Supabase bilgilerinizi ve port numarasını düzenleyin:

```
SUPABASE_URL=your_supabase_url_here
SUPABASE_KEY=your_supabase_service_role_key_here
WS_PORT=3001
WS_HOST=0.0.0.0
```

### 7. Firewall Ayarları

Eğer UFW (Uncomplicated Firewall) kullanıyorsanız, WebSocket portunuzu açın:

```bash
sudo ufw allow 3001/tcp
sudo ufw status
```

### 8. PM2 ile Sürekli Çalıştırma

PM2, Node.js uygulamalarını arka planda sürekli çalıştırmak için kullanılan bir süreç yöneticisidir. PM2'yi global olarak yükleyin:

```bash
sudo npm install -g pm2
```

WebSocket sunucusunu PM2 ile başlatın:

```bash
cd ~/laterp-websocket
pm2 start websocket.js --name "laterp-websocket"
```

PM2'nin sistem başlangıcında otomatik başlamasını sağlayın:

```bash
pm2 startup
```

Çıktıda gösterilen komutu çalıştırın.

Mevcut PM2 yapılandırmasını kaydedin:

```bash
pm2 save
```

### 9. PM2 Komutları

PM2 ile sunucunuzu yönetmek için kullanabileceğiniz bazı komutlar:

- Durumu kontrol etme: `pm2 status`
- Logları görüntüleme: `pm2 logs laterp-websocket`
- Sunucuyu yeniden başlatma: `pm2 restart laterp-websocket`
- Sunucuyu durdurma: `pm2 stop laterp-websocket`
- Sunucuyu başlatma: `pm2 start laterp-websocket`

## SSL/TLS ile Güvenli WebSocket (WSS) Kurulumu

Eğer güvenli WebSocket (WSS) kullanmak istiyorsanız, bir reverse proxy (Nginx veya Apache) kurmanız ve SSL sertifikası yapılandırmanız gerekir.

### Nginx ile WSS Kurulumu

1. Nginx'i yükleyin:

```bash
sudo apt install nginx -y
```

2. Certbot'u yükleyin (Let's Encrypt SSL sertifikaları için):

```bash
sudo apt install certbot python3-certbot-nginx -y
```

3. Nginx yapılandırma dosyası oluşturun:

```bash
sudo nano /etc/nginx/sites-available/laterp-websocket
```

4. Aşağıdaki yapılandırmayı ekleyin (domain adınızı değiştirin):

```nginx
server {
    listen 80;
    server_name ws.yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

5. Yapılandırmayı etkinleştirin:

```bash
sudo ln -s /etc/nginx/sites-available/laterp-websocket /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

6. SSL sertifikası alın:

```bash
sudo certbot --nginx -d ws.yourdomain.com
```

7. Certbot, yapılandırmayı otomatik olarak güncelleyecektir. Nginx'i yeniden yükleyin:

```bash
sudo systemctl reload nginx
```

Artık `wss://ws.yourdomain.com` üzerinden güvenli WebSocket bağlantısı kurabilirsiniz.

## Sorun Giderme

### Bağlantı Sorunları

- Port'un açık olduğundan emin olun: `sudo ufw status`
- WebSocket sunucusunun çalıştığını kontrol edin: `pm2 status`
- Logları kontrol edin: `pm2 logs laterp-websocket`

### PM2 Sorunları

PM2 ile ilgili sorunlar yaşıyorsanız:

```bash
pm2 delete laterp-websocket
pm2 start websocket.js --name "laterp-websocket"
```

### Nginx Sorunları

Nginx yapılandırmasını kontrol edin:

```bash
sudo nginx -t
```

Hata varsa düzeltin ve Nginx'i yeniden yükleyin:

```bash
sudo systemctl reload nginx
```

## Güvenlik Önerileri

1. Root kullanıcısı yerine sudo yetkisi olan bir kullanıcı oluşturun
2. SSH için anahtar tabanlı kimlik doğrulama kullanın
3. UFW veya iptables ile güvenlik duvarını yapılandırın
4. Fail2ban ile brute force saldırılarını engelleyin
5. Düzenli olarak sistem güncellemelerini yapın