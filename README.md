# DigPro

App móvil en HTML para registrar cobros por Yape y Plin. Consulta ingresos, publicidad y ganancia neta por día en soles. Las fechas y horas de compra usan la hora de Lima.

| Curso | Precio normal | Con promoción |
| --- | ---: | ---: |
| Rituales | S/ 10.00 | S/ 5.00 |
| Cócteles | S/ 5.00 | S/ 3.00 |

Puedes editar el pago después de elegir el curso y la promoción. El importe de publicidad es el total del día seleccionado. Si ese día no hubo gasto, guarda S/ 0 para quitar el aviso de publicidad pendiente.

Pulsa el botón **Calendario** para ver la ganancia neta por mes y desplegar las semanas. Cada semana suma de lunes a domingo y cada mes suma únicamente sus fechas. Toca un día para consultar sus ventas y publicidad.

## Abrir en la computadora

Haz doble clic en **Abrir Caja diaria.cmd** en la carpeta de la app. Se abrirá el navegador. Mantén abierta la ventana del servidor mientras uses la app. Si abres `public/index.html` directamente, verás una vista previa del diseño.

Para preparar Google Sheets y abrir la app desde PowerShell:

1. Abre PowerShell en la carpeta `APP - PARA PAGOS`.
2. Ejecuta `npm.cmd ci` si todavía no se han instalado las dependencias. Usa Node.js 24.
3. Ejecuta `npm.cmd run setup`. La app detecta el JSON de servicio que ya está en la carpeta y crea o comprueba las pestañas `App - Ventas` y `App - Publicidad` en la [hoja de Google Sheets](https://docs.google.com/spreadsheets/d/1fdFgdntMbLI7Vp2a8kgjuJij5mL8AWw0CM9ztEBeEDk/edit).
4. Ejecuta `npm.cmd start` y abre [DigPro en esta computadora](http://127.0.0.1:3000/).

Si el paso 3 devuelve `SERVICE_DISABLED`, habilita [Google Sheets API en el proyecto 430611240465](https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=430611240465) con una cuenta administradora y vuelve a ejecutar el comando. Comparte la hoja con el `client_email` del JSON como Editor.

## Subir manualmente a Vercel

1. Confirma primero que `npm.cmd run setup` termina correctamente.
2. Importa el proyecto en Vercel con el preset **Other** y Node.js **24.x**. `vercel.json` indica que los archivos de la interfaz están en `public`. Vercel ejecuta `api/caja.mjs` como función Node.js.
3. En **Settings → Environment Variables**, crea `GOOGLE_SERVICE_ACCOUNT_JSON` con el contenido íntegro del archivo de credenciales. Marca la variable como sensible. Conserva el archivo original en tu computadora y fuera del código que subas.
4. Crea `APP_PASSWORD` con una clave larga y aleatoria de al menos 12 caracteres. Esa será la clave que te pedirá la app en el celular.
5. Abre el archivo local `.env.push.local` y copia **PUSH_PUBLIC_KEY**, **PUSH_PRIVATE_KEY** y **CRON_SECRET** a las variables de entorno de **Production**. Marca la clave privada y el secreto del cron como sensibles. Si el archivo aún no existe, créalo con `npm.cmd run push:keys`. Conserva las mismas claves en futuros despliegues para mantener los avisos activos.
6. Despliega a producción. En iPhone, abre esa URL en Safari y toca **Compartir → Añadir a pantalla de inicio → Abrir como app web**.
7. Desde el icono de DigPro, ingresa con tu clave y toca **Aviso de medianoche → Activar aviso → Permitir**. Usa **Enviar prueba** para revisar el sonido y comprueba **Ajustes → Notificaciones → DigPro → Sonidos** en el iPhone. El modo silencio y Concentración pueden silenciar el aviso.

Vercel ejecuta el cierre a las 05:00 UTC, que son las 12:00 a. m. en Lima. El cierre incluye ventas menos publicidad del día que acaba de terminar. Vercel Pro programa por minuto. En Hobby la ejecución puede llegar hasta 59 minutos después de la hora prevista. El aviso se puede recibir con DigPro cerrada.

Si cambias de hoja, configura `SHEETS_ID` en el entorno local y en Vercel. Ejecuta la preparación de pestañas para esa hoja antes de usarla.

[Documentación de variables de entorno de Vercel](https://vercel.com/docs/environment-variables)

[Precisión de Vercel Cron](https://vercel.com/docs/cron-jobs/usage-and-pricing)
