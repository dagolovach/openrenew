FROM alpine:3.20
RUN apk add --no-cache curl
CMD sh -c 'echo "0 8 * * * curl -fsS -H \"Authorization: Bearer $CRON_SECRET\" http://web:3000/api/cron/send-alerts" > /etc/crontabs/root && echo "0 9 * * 1 curl -fsS -H \"Authorization: Bearer $CRON_SECRET\" http://web:3000/api/cron/send-weekly-digest" >> /etc/crontabs/root && crond -f -l 2'
