# RemesaYa como app instalable y como APK

RemesaYa es una **PWA** (Progressive Web App): se instala desde el navegador, se abre a pantalla completa, tiene icono propio y funciona con caché para el shell. Además puedes empaquetarla como **APK** de Android para distribuirla por WhatsApp, correo o tu web.

---

## 1. Instalar como app (sin APK) — recomendado

### Android (Chrome / Edge / Samsung Internet)
1. Abre `https://TU-SERVICIO.onrender.com`.
2. Aparece el botón **Instalar** en la barra superior, o el aviso "Añadir a pantalla de inicio".
3. Si no aparece: menú **⋮ → Instalar aplicación**.

### iPhone / iPad (Safari)
1. Abre el sitio en **Safari** (no Chrome; iOS solo instala desde Safari).
2. Toca **Compartir ↑**.
3. **Añadir a pantalla de inicio** → **Añadir**.

### Computadora (Chrome / Edge)
1. Icono de instalar en la barra de direcciones, o **⋮ → Instalar RemesaYa**.

La app instalada se abre sin barra de navegador, con splash screen y sesión persistente. Los datos financieros **no** se guardan en caché: el service worker solo cachea el shell y deja pasar `/api/*` siempre a la red.

---

## 2. Generar el APK

El APK es un contenedor (Trusted Web Activity) que abre tu PWA a pantalla completa. No reescribe la app: sigue usando el mismo servidor y la misma base de datos.

### Requisitos
- Node.js 18+
- JDK 17 (`sudo apt install openjdk-17-jdk`)
- Android SDK Build-Tools (`sdkmanager "build-tools;34.0.0" "platforms;android-34"`)
- La PWA publicada con **HTTPS** (Render ya lo da)

### Opción A — Bubblewrap (línea de comandos)

```bash
npm i -g @bubblewrap/cli

# Genera el proyecto a partir del manifest publicado
bubblewrap init --manifest https://TU-SERVICIO.onrender.com/manifest.webmanifest

# Compila el APK
bubblewrap build
```

Salida: `app-release-signed.apk`. Cópialo a `app/public/app.apk` y el botón **Descargar APK** aparecerá solo en la landing (se detecta con un `HEAD /app.apk`).

> Bubblewrap pide el **SHA-256 del certificado de firma** para verificar que el APK y el sitio son del mismo dueño. Usa `bubblewrap build` con tu keystore y pega el fingerprint que imprime.

### Opción B — PWABuilder (sin instalar nada)

1. Entra a <https://www.pwabuilder.com>.
2. Pega la URL de tu PWA y pulsa **Start**.
3. **Package for stores → Android**.
4. Descarga el `.apk` (o el `.aab` para Google Play).
5. Súbelo a `app/public/app.apk`.

### Opción C — Capacitor (si quieres código nativo)

```bash
npm i @capacitor/core @capacitor/cli @capacitor/android
npx cap init RemesaYa app.remesaya.mobile --web-dir=public
npx cap add android
npx cap sync
cd android && ./gradlew assembleRelease
```

Salida: `android/app/build/outputs/apk/release/app-release.apk`.

---

## 3. Firma del APK

Un APK sin firmar no se instala. Genera un keystore **una sola vez** y guárdalo con la misma disciplina que `BACKUP_ENCRYPTION_KEY`:

```bash
keytool -genkey -v -keystore remesaya.keystore -alias remesaya \
  -keyalg RSA -keysize 2048 -validity 10000
```

Sin ese keystore no podrás publicar actualizaciones del APK (Android rechaza una firma distinta). Guárdalo fuera del repositorio.

---

## 4. Qué NO hace el APK

- No incluye una base de datos local: la base vive en el servidor (Render + disco persistente) y se protege con respaldos cifrados. Esto es intencional: si la base estuviera en el teléfono, cada usuario tendría una copia distinta y podrías perder las transacciones.
- No evita el login: la sesión se guarda en una cookie firmada `HttpOnly`.
- No cambia la seguridad: el APK es solo una ventana; toda la lógica y los secretos siguen en el servidor.

---

## 5. Verificar que quedó bien

```bash
# el manifest se sirve correctamente
curl -s https://TU-SERVICIO.onrender.com/manifest.webmanifest | head

# el service worker existe
curl -sI https://TU-SERVICIO.onrender.com/sw.js | head -1

# el APK está disponible (si lo subiste)
curl -sI https://TU-SERVICIO.onrender.com/app.apk | head -1
```
