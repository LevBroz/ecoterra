# EcoTerra · App Android (Capacitor)

Empaqueta la web app (`frontend/`) como APK nativa, reutilizando **todo** el
código sin reescribir nada. El WebView carga los mismos HTML/JS; Supabase y el
backend de Render se siguen consumiendo por internet igual que en la web.

> La función de **pase QR** (residente genera, vigilante escanea) ya funciona en
> la web y dentro del WebView. Esta guía solo la "envuelve" para instalarla como app.

## Prerrequisitos (en tu máquina)

- **Node 20+** (ya lo tienes para el backend)
- **JDK 17** (Android Studio lo incluye)
- **Android Studio** (trae el Android SDK y el emulador)
- Cuenta de **Google Play Developer** ($25, único pago) — solo si vas a publicar

## Primera vez

```powershell
cd mobile
npm install
npm run add:android      # crea mobile/android (proyecto nativo)
npm run sync             # copia frontend/ al proyecto + instala plugins
```

### Plugins nativos

Están en `package.json` y `cap sync` los cablea solo:
- `@capacitor-mlkit/barcode-scanning` → escáner QR nativo del vigilante.
- `@capacitor/share` → compartir el pase por WhatsApp (hoja del sistema).

### Permisos del manifest (tras regenerar `android/`)

`android/` está en `.gitignore`, así que si lo borras y vuelves a correr
`cap add android` debes re-aplicar estos cambios en
`mobile/android/app/src/main/AndroidManifest.xml`:

Dentro de `<manifest>` (antes de `</manifest>`):
```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
```

Dentro de `<application>` (para que el módulo MLKit se baje al instalar):
```xml
<meta-data android:name="com.google.mlkit.vision.DEPENDENCIES" android:value="barcode_ui" />
```

> El escáner usa el **escáner de código de Google (MLKit)**, que gestiona la
> cámara por su cuenta (no depende de `getUserMedia`, que el WebView bloquea).
> Requiere Google Play Services — usa un teléfono real o un emulador con Play Store.

## Probar / compilar

```powershell
cd mobile
npm run open:android     # abre Android Studio → Run (emulador o teléfono USB)
```

Para generar el APK/AAB: en Android Studio → **Build > Build Bundle(s)/APK(s)**,
o para publicar → **Build > Generate Signed Bundle/APK** (necesitas un keystore).

## Cada vez que cambie el frontend

```powershell
cd mobile
npm run copy             # vuelca los cambios de frontend/ al proyecto Android
```

## Notas

- `webDir` apunta a `../frontend`; Capacitor copia ese contenido al APK. Las
  rutas absolutas (`/assets/...`, `/app/...`) resuelven contra la raíz del WebView.
- `appId`: `com.ecoterra.app` (cámbialo si registras otro en Play).
- **Cámara:** el escáner usa `getUserMedia` + `BarcodeDetector` (nativos del
  WebView de Android moderno). Si en algún dispositivo viejo la cámara no abre,
  el plan B es el plugin nativo `@capacitor-mlkit/barcode-scanning` (requiere
  cambiar `guard.js` para usarlo solo en plataforma nativa).
- `mobile/android/` y `mobile/node_modules/` están en `.gitignore`: se regeneran
  con `npm install` + `npm run add:android`. Lo versionado es solo la config.
- Esto **no afecta** a Netlify (publica `frontend/`) ni a Render (rootDir `backend/`).
```
