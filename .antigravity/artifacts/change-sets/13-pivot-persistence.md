# Pivot de Rota: Persistência contra Hard Reset do Docker

## Motivo do Pivot
A abordagem anterior utilizou "Docker Volumes" (`xgen_db_data`), que é o padrão de segurança para Linux. No entanto, o usuário relatou que ao "resetar o Docker" (provavelmente um 'Clean/Purge Data' ou reinicialização pesada do Docker Desktop no Windows), os volumes internos estão sendo apagados. Isso prova que para esse ambiente específico, não podemos depender da engine do Docker para guardar os dados.

## Estado Atual
O `docker-compose.yml` está usando `xgen_db_data:/app/apps/api/prisma` e `xgen_redis_data:/var/lib/redis`.

## Novo Objetivo
Garantir que o arquivo `dev.db` (SQLite) e a fila do Redis sejam escritos fisicamente no HD do Windows do usuário (Bind Mounts), de forma que mesmo se o usuário desinstalar o Docker, os dados das chaves de API não se percam.
