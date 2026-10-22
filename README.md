# workspace-mcp

Servidor MCP que pone carpetas autorizadas de una PC a disposición de un agente: leer, buscar y escribir archivos, además de búsqueda web opcional y ejecución de comandos opcional.

## Herramientas

| Tool | Qué hace |
|---|---|
| `list_roots` | Muestra las carpetas habilitadas y el modo |
| `list_dir` | Lista el contenido de una carpeta (hasta 3 niveles) |
| `read_file` | Lee texto con números de línea; permite `offset` y `limit` |
| `find_files` | Busca archivos por glob |
| `search_text` | Busca texto o expresiones regulares |
| `write_file` | Crea o reemplaza archivos (no se registra en solo lectura) |
| `edit_file` | Reemplaza texto exacto (no se registra en solo lectura) |
| `internet_search` | Busca en Brave Search; requiere API key |
| `run_terminal` | Ejecuta un comando único; requiere habilitación explícita |

En Agent Runtime, con el identificador de servidor `workspace`, las herramientas aparecen como `workspace__read_file`, etc.

## Uso con Docker

El Compose de este repositorio ejecuta **solo workspace-mcp**. No inicia Agent Runtime, PostgreSQL ni otros servicios: podés desplegar el MCP por separado y conectarlo a un Runtime existente.

```powershell
Copy-Item .env.example .env
# Editar .env: definir WORKSPACE_MCP_TOKEN y WORKSPACE_MCP_WORKSPACE.
# WORKSPACE_MCP_WORKSPACE es una ruta del host; por ejemplo D:/Workspace/projects.
docker compose up -d --build
```

El servidor queda publicado en `127.0.0.1:3020`. Para revisar su estado y logs:

```powershell
docker compose ps
docker compose logs -f workspace-mcp
```

La carpeta de `WORKSPACE_MCP_WORKSPACE` es el único volumen del host montado dentro del contenedor, en `/workspace`. Compose configura `/workspace` como raíz permitida. No se publica el contenido del disco fuera de esa carpeta.

Para habilitar comandos de terminal, configurá `WORKSPACE_MCP_ENABLE_TERMINAL=true` en `.env` y recreá el servicio:

```powershell
docker compose up -d --build --force-recreate workspace-mcp
```

Para habilitar búsqueda web, definí `WORKSPACE_MCP_BRAVE_API_KEY` en `.env` y recreá el servicio. Las consultas se envían a Brave; la herramienta devuelve resultados y URLs, pero no abre las páginas.

## Conexión desde Agent Runtime

Agregá un servidor MCP con el identificador `workspace` y estos valores, adaptando la URL según dónde corra Runtime:

- Runtime en Docker Desktop y MCP en el host: `http://host.docker.internal:3020/mcp`.
- Runtime nativo en el mismo host: `http://localhost:3020/mcp`.
- Runtime en otro host/red: configurá la URL alcanzable del MCP y exponelo detrás de TLS y un proxy/firewall apropiados; no publiques el servicio directamente a Internet.

Configuración conceptual del servidor:

```json
{
  "workspace": {
    "url": "http://host.docker.internal:3020/mcp",
    "auth": null,
    "headers": {
      "Authorization": "Bearer <WORKSPACE_MCP_TOKEN>"
    },
    "optional": true
  }
}
```

`optional: true` permite que Runtime siga funcionando si el MCP no está disponible. El token MCP es un secreto de servicio: guardá el mismo valor en la configuración de Runtime y en `.env` del MCP. En Agent Runtime, las tools quedan bajo el prefijo `workspace__`.

Para que Runtime resuelva el login de usuario contra workspace-mcp, configurá en **Admin → Auth** la introspección `http://host.docker.internal:3020/auth/me` (Runtime en Docker Desktop) o `http://localhost:3020/auth/me` (Runtime nativo). En workspace-mcp, `WORKSPACE_MCP_AUTH_USERNAME`, `WORKSPACE_MCP_AUTH_PASSWORD` y `WORKSPACE_MCP_AUTH_USER_ID` deben estar configurados juntos; el password debe tener al menos 12 caracteres. El `userId` debe permanecer estable, porque Runtime lo usa para aislar conversaciones.

El Bearer de usuario obtenido mediante `POST /auth/login` es independiente del `WORKSPACE_MCP_TOKEN`: el primero autentica al usuario frente a Runtime; el segundo autoriza a Runtime a llamar las herramientas MCP.

## Ejecución nativa

La modalidad nativa es útil para desarrollo. En este caso, las raíces permitidas son rutas reales del host y se separan con `;` en Windows:

```powershell
npm install
Copy-Item .env.example .env
# Configurar WORKSPACE_MCP_ROOTS y WORKSPACE_MCP_TOKEN en .env.
npm run dev
```

Por defecto escucha en `127.0.0.1:3020`. Para producción, usar `npm run build` y `npm start`.

## Seguridad

- Solo se puede acceder a `WORKSPACE_MCP_ROOTS`. Las rutas que salen de esas raíces mediante `..` o symlinks/junctions se rechazan.
- Secretos bloqueados para lectura y escritura: `.env`, `.env.*` (salvo `.env.example`), `*.pem`, `*.key`, `*.pfx`, `*.p12`, `id_rsa*` y `.npmrc`.
- No escribe dentro de `.git`; búsquedas y listados omiten directorios como `node_modules`, `.git` y `dist`.
- `/mcp` exige `Authorization: Bearer <WORKSPACE_MCP_TOKEN>`. Usá un secreto aleatorio de al menos 24 caracteres y no lo compartas.
- El puerto Docker se publica solo en loopback (`127.0.0.1`). Para acceso remoto, usa un proxy con TLS, autenticación y reglas de red adecuadas.
- `run_terminal` ejecuta comandos arbitrarios con los permisos del proceso dentro del contenedor. Está deshabilitada por defecto; si se activa, el proceso puede acceder a los montajes disponibles en el contenedor.
- El login local es para un propietario configurado por entorno, no un sistema multiusuario. Las sesiones duran 8 horas, se guardan en memoria y se invalidan al reiniciar.
- `internet_search` consulta Brave; sus resultados son contenido externo no confiable.
- Los comandos tienen un timeout máximo de 120 segundos y la salida se limita a 64 KiB.
