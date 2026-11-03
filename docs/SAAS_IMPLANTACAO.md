# Colocando o painel no ar — passo a passo

Cenário: servidor Ubuntu local, usuário `dropsales`, PM2 e Nginx já em uso, DNS na Cloudflare.
Endereços: painel em `painel.saleseassociados.com.br`; escritórios em `nome.saleseassociados.com.br`.
A instalação atual (`disparazap.saleseassociados.com.br`) não muda: é um endereço reservado e o painel nunca o usa.

Portas sugeridas: sistema atual `3333` · painel `3340` · escritórios a partir de `3400` (uma por escritório; anote).

## 0. Antes de começar

1. O deploy automático da versão 2.61.0 (ou superior) precisa ter terminado: ele traz o painel compilado em `~/disparador-sales2/server/dist/painel/`. Confira:

   ```bash
   ls ~/disparador-sales2/server/dist/painel/index.js
   ```

2. Descubra como o site atual chega ao servidor (define o passo 2):
   - Na Cloudflare → **DNS**, abra o registro `disparazap`. Se for **CNAME para `<id>.cfargotunnel.com`**, você usa **Cloudflare Tunnel** (caminho A). Se for **A com o IP público** (e há redirecionamento de portas 80/443 no roteador), é **acesso direto** (caminho B).

## 1. Instalar o painel no servidor

```bash
cd ~/disparador-sales2
```

```bash
bash server/scripts/painel-instalar.sh painel.saleseassociados.com.br saleseassociados.com.br
```

O script cria `/srv/disparazap-painel` (permissão 700), gera o `painel.env` (permissão 600) com **senha do administrador** e **token do webhook** aleatórios, inicia o painel no PM2 (`dz-painel`, porta 3340) e testa `http://127.0.0.1:3340/healthz`. **Anote a senha exibida no final** (não aparece de novo).

Se o PM2 ainda não sobe sozinho no boot: `pm2 startup` (siga a instrução que ele imprimir) e `pm2 save`.

## 2. Nginx

Crie o arquivo do painel:

```bash
sudo nano /etc/nginx/conf.d/dz-ip-real.conf
```

```nginx
# IP real do visitante quando o tráfego passa pela Cloudflare (usado no limite de tentativas de login)
map $http_cf_connecting_ip $dz_ip {
    default $http_cf_connecting_ip;
    ""      $remote_addr;
}
```

```bash
sudo nano /etc/nginx/sites-available/dz-painel
```

**Caminho A — Cloudflare Tunnel** (o túnel entrega em HTTP na porta 80; sem certificado no servidor):

```nginx
server {
    listen 80;
    server_name painel.saleseassociados.com.br;
    location / {
        proxy_pass http://127.0.0.1:3340;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $dz_ip;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

**Caminho B — acesso direto** (Cloudflare com proxy laranja + certificado de origem). Gere em Cloudflare → SSL/TLS → **Origin Server → Create Certificate** com os nomes `saleseassociados.com.br` e `*.saleseassociados.com.br`, salve em `/etc/ssl/cloudflare/saleseassociados.pem` e `.key` (chave com `chmod 600`) e deixe SSL/TLS em **Full (strict)**:

```nginx
server {
    listen 80;
    server_name painel.saleseassociados.com.br;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl http2;
    server_name painel.saleseassociados.com.br;
    ssl_certificate     /etc/ssl/cloudflare/saleseassociados.pem;
    ssl_certificate_key /etc/ssl/cloudflare/saleseassociados.key;
    location / {
        proxy_pass http://127.0.0.1:3340;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $dz_ip;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Ative e recarregue:

```bash
sudo ln -s /etc/nginx/sites-available/dz-painel /etc/nginx/sites-enabled/dz-painel
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 3. DNS na Cloudflare

- **Caminho A (túnel):** Zero Trust → Networks → Tunnels → seu túnel → **Public Hostnames** → adicione `painel.saleseassociados.com.br` → serviço `HTTP` `localhost:80` (o Nginx separa pelo nome). Para os escritórios, adicione também o hostname curinga `*.saleseassociados.com.br` → `HTTP localhost:80`, com um registro DNS curinga `*` (CNAME para o mesmo `<id>.cfargotunnel.com`, com proxy ligado).
- **Caminho B (direto):** DNS → crie **dois registros A, com proxy laranja ligado**, apontando para o IP público: `painel` e `*`.

O registro curinga não afeta os registros que já existem (`disparazap` continua valendo: o mais específico vence). Domínios do tipo `qualquer.saleseassociados.com.br` passam a chegar ao Nginx; os que não têm site configurado caem no servidor padrão do Nginx.

Teste: abra `https://painel.saleseassociados.com.br`. Deve aparecer a tela de login. Entre com `admin` e a senha do passo 1, depois **apague a linha `PAINEL_ADMIN_PASSWORD`** de `/srv/disparazap-painel/painel.env`.

## 4. Asaas (cobrança)

1. Crie primeiro a conta **sandbox** (ambiente de testes do Asaas, separado da conta real) e gere uma **chave de API** em Integrações → Chaves de API.
2. Edite a configuração e preencha `ASAAS_API_KEY` (o `ASAAS_BASE_URL` já aponta para o sandbox):

   ```bash
   nano /srv/disparazap-painel/painel.env
   ```

   ```bash
   pm2 restart dz-painel
   ```

3. No Asaas → Integrações → **Webhooks** → novo webhook: URL `https://painel.saleseassociados.com.br/webhooks/asaas`, **token de autenticação** = valor de `ASAAS_WEBHOOK_TOKEN` (o script exibiu; também está no `painel.env`), versão da API v3, eventos de **cobranças** e de **assinaturas**.
4. No painel, **Configuração** deve mostrar “Cobrança automática configurada” e “Webhook configurado”.
5. Para produção: gere a chave da conta real, troque `ASAAS_BASE_URL` por `https://api.asaas.com/v3` e refaça o webhook na conta real.

## 5. Escritórios: criação automática (instalação única + formulário)

### 5.1 Instalação única do provisionamento automático

Depois disto, **nenhum escritório novo exige comando nem arquivo de Nginx**. Rode uma vez, como o usuário do sistema (`dropsales`), informando a porta em que o seu Nginx escuta (a mesma do túnel; neste servidor é `8081`):

```bash
cd ~/disparador-sales2 && bash server/scripts/provisionamento-instalar.sh 8081 saleseassociados.com.br
```

O script (pode rodar de novo sem problema):

- cria o arquivo `/srv/disparazap-painel/nginx/escritorios.map` e **adota as instâncias que já existem** em `/srv/disparazap`;
- cria **um único** bloco curinga `*.saleseassociados.com.br` (`/etc/nginx/conf.d/dz-escritorios.conf`) que escolhe a porta pelo nome do escritório. Nomes sem escritório cadastrado dão 404; `painel` e `disparazap` continuam com os blocos próprios;
- libera por `sudo` **apenas** `nginx -t` e `systemctl reload nginx` (arquivo `/etc/sudoers.d/dz-painel`);
- liga `PAINEL_AUTO_PROVISIONAR=1` no `painel.env` e reinicia o painel. Se o Nginx recusar a configuração, ela é desfeita e nada é recarregado.

Opcional: apague os arquivos antigos por escritório (o script lista os comandos no fim), pois o bloco curinga os substitui.

### 5.2 Criar um escritório

1. No painel → **Planos** → edite “Escritório” e defina o preço mensal (planos com preço 0 não geram cobrança automática).
2. **Novo escritório**: nome, e-mail, plano, dias de teste. O endereço sai do nome e a porta é automática.
3. Ao clicar em **Criar escritório**, o painel cria a instância, registra o endereço no Nginx, cria a cobrança no Asaas e mostra o **link e a senha inicial** (botão “Copiar mensagem de acesso” para enviar ao cliente). A senha só aparece nessa tela; peça para trocar no primeiro acesso.
4. Se algo falhar (por exemplo, o build do sistema ausente), o escritório fica cadastrado e a tela diz o motivo. Abra o escritório e use **Criar/ativar sistema no servidor** para tentar de novo.

### 5.3 No dia a dia

Na ficha do escritório, seção **Sistema no servidor**: status (No ar/Parada/Não criada), **Reiniciar** e **Remover do servidor** (para o sistema e tira o endereço do ar; os dados ficam guardados). **Nova chave de licença** já é aplicada na instância e ela reinicia sozinha. Para um escritório criado à mão antes desta instalação, **Criar/ativar sistema no servidor** apenas adota a instância existente, sem alterar os dados dela.

### 5.4 Se preferir o modo manual (sem `PAINEL_AUTO_PROVISIONAR`)

O painel mostra os blocos de implantação (`.env`, PM2 e Nginx) e você aplica com `server/scripts/instancia-aplicar.sh <slug> <porta> <arquivo.env>`. O exemplo de Nginx gerado serve a interface estática e envia só `/api/` e `/socket.io/` à instância.

### 5.5 Testar a cobrança no sandbox

Abra o link da fatura do escritório, confirme o pagamento no sandbox do Asaas e veja o vencimento mudar no painel (webhook funcionando).

## 6. Backup do painel (essencial)

```bash
sudo apt install -y sqlite3
```

```bash
nano ~/backup-painel.sh
```

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
D=/srv/disparazap-painel/data
B=$HOME/disparazap-backups/painel
mkdir -p "$B"
sqlite3 "$D/painel.sqlite3" ".backup '$B/painel-$(date +%F).sqlite3'"
cp -n "$D/licenca-privada.pem" "$D/licenca-publica.pem" "$B/"
find "$B" -name 'painel-*.sqlite3' -mtime +30 -delete
```

```bash
chmod 700 ~/backup-painel.sh && (crontab -l 2>/dev/null; echo '0 3 * * * $HOME/backup-painel.sh') | crontab -
```

Copie também a pasta de backups para fora do servidor. **A chave `licenca-privada.pem` é insubstituível**: sem ela é preciso emitir nova chave pública e reconfigurar todas as instâncias.

## 7. Operação

- **Atualizar:** o deploy atualiza o código. Depois reinicie o painel e as instâncias dos escritórios: `pm2 restart dz-painel dz-teste` (liste com `pm2 ls`).
- **Logs:** `pm2 logs dz-painel` · `pm2 logs dz-teste`.
- **Novo escritório:** painel → Novo escritório → `instancia-aplicar.sh` → Nginx → (DNS curinga já cobre).
- **Suspender/reativar/cancelar, registrar pagamento, nova chave:** na tela do escritório.

## 8. Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| 502 no painel | Painel parado: `pm2 ls` / `pm2 logs dz-painel`. |
| Login do painel “não segura” | `PAINEL_PUBLIC_URL` deve ser `https://…` e o acesso, por HTTPS (o cookie é seguro). |
| Webhook responde 401/503 | Token diferente do `ASAAS_WEBHOOK_TOKEN` (401) ou variável vazia (503). |
| Escritório sem “último contato” | `LICENSE_SERVER_URL`/`LICENSE_KEY` errados; veja `pm2 logs dz-teste`. Chave nova invalida a anterior. |
| Instância somente leitura | Assinatura vencida/suspensa: aviso na tela; após regularizar use “Já regularizei · verificar agora”. |
| `nginx -t` com `default_server` duplicado | Já existe outro `default_server`; remova a palavra dos novos arquivos. |

## 9. Segurança recomendada

- Proteja `painel.saleseassociados.com.br` com **Cloudflare Access** (login por e-mail), liberando **sem login** apenas `/api/v1/*` (consulta de licença) e `/webhooks/*` (Asaas), que precisam ser públicos.
- Mantenha `painel.env` com permissão 600 e fora de qualquer repositório.
- Faça backup do `ENCRYPTION_KEY` de cada escritório (o painel não o guarda).
