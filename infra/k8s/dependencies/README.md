# FIAP X local dependencies

These manifests create only the local, single-node dependencies for FIAP X. They do not contain
application Deployments, Ingress, HPA, TLS, or cloud resources.

## Secret creation

`secret.example.yaml` documents the required keys and is intentionally excluded from
`kustomization.yaml`. Do not apply the example. Generate the real demonstration Secret only in the
explicitly selected Minikube context:

```sh
test "$(kubectl config current-context)" = "minikube"
kubectl apply -f infra/k8s/dependencies/namespace.yaml

fiap_mysql_root_password="$(openssl rand -hex 24)"
fiap_mysql_password="$(openssl rand -hex 24)"
fiap_redis_password="$(openssl rand -hex 24)"
fiap_rabbitmq_password="$(openssl rand -hex 24)"
fiap_grafana_password="$(openssl rand -hex 24)"

kubectl --namespace fiap-x create secret generic fiap-x-dependencies \
  --from-literal=MYSQL_ROOT_PASSWORD="$fiap_mysql_root_password" \
  --from-literal=MYSQL_USERNAME=fiap_x \
  --from-literal=MYSQL_PASSWORD="$fiap_mysql_password" \
  --from-literal=REDIS_PASSWORD="$fiap_redis_password" \
  --from-literal=REDIS_URL="redis://:$fiap_redis_password@redis:6379" \
  --from-literal=RABBITMQ_USERNAME=fiap_x \
  --from-literal=RABBITMQ_PASSWORD="$fiap_rabbitmq_password" \
  --from-literal=RABBITMQ_URL="amqp://fiap_x:$fiap_rabbitmq_password@rabbitmq:5672" \
  --from-literal=GRAFANA_ADMIN_USER=admin \
  --from-literal=GRAFANA_ADMIN_PASSWORD="$fiap_grafana_password" \
  --dry-run=client --output=yaml | kubectl apply --filename=-

unset fiap_mysql_root_password fiap_mysql_password fiap_redis_password
unset fiap_rabbitmq_password fiap_grafana_password
```

The generated values remain local to the cluster and are not written to the repository.

## Dependency installation and database setup

After confirming the context again, apply the dependency bundle and wait for the migration Job:

```sh
test "$(kubectl config current-context)" = "minikube"
kubectl apply --kustomize infra/k8s/dependencies
kubectl --namespace fiap-x wait --for=condition=complete job/mysql-migrate --timeout=180s
```

The migration Job mirrors the existing SQL migrations and records each applied migration in a
small `schema_migrations` table so retries are safe. It also grants the generated application user
access to `auth_db`, `video_db`, and `notification_db`.

The existing Node.js seed hashes and inserts the local demonstration users. Run it from the
repository while a MySQL port-forward is active; no seed credential is stored in a manifest:

```sh
test "$(kubectl config current-context)" = "minikube"
kubectl --namespace fiap-x port-forward service/mysql 3306:3306
```

In a second terminal:

```sh
fiap_mysql_username="$(kubectl --namespace fiap-x get secret fiap-x-dependencies --output=jsonpath='{.data.MYSQL_USERNAME}' | base64 --decode)"
fiap_mysql_password="$(kubectl --namespace fiap-x get secret fiap-x-dependencies --output=jsonpath='{.data.MYSQL_PASSWORD}' | base64 --decode)"

MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USERNAME="$fiap_mysql_username" \
MYSQL_PASSWORD="$fiap_mysql_password" \
MYSQL_CONNECTION_LIMIT=2 \
MYSQL_SSL=false \
npm run db:seed

unset fiap_mysql_username fiap_mysql_password
```

## Shared video storage contract

The `video-storage` PVC uses `ReadWriteOnce`, which permits the Video and Processor pods to mount
the same claim concurrently on Minikube's single node. Stage 9.3 should reference the claim name
`video-storage` from both workloads and mount it at `/data/videos`; no application workload is
defined here.

Prometheus and Grafana use `emptyDir` for short-lived demonstration data. MySQL, Redis, RabbitMQ,
and the shared video directory use persistent claims.
