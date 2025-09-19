## [Demo](https://caller-siblings.ru/) on caller-siblings.ru (with streaming)
## [Demo](https://bm12.github.io/screen-capture/public/index.html) on github-pages (just for capturing in file)

## Running with HTTPS certificates

The server always runs over HTTPS and reads certificates from the paths provided via
environment variables. For production deployments obtain trusted certificates
(for example with [Certbot](https://certbot.eff.org/)) and expose them to the
application:

```bash
export SSL_KEY_PATH=/etc/letsencrypt/live/caller-siblings.ru/privkey.pem
export SSL_CERT_PATH=/etc/letsencrypt/live/caller-siblings.ru/fullchain.pem
# Optional: export SSL_CA_PATH and SSL_PASSPHRASE if your provider requires them

npm run prod
```

For local development the repository keeps self-signed certificates in `./ssl`.
Running `npm start` will use them automatically:

```bash
npm start
```
