/**
 * Pure helper: builds the curl example shown inside the
 * IoT Webhook Generator modal. Extracted so the snippet can be
 * unit-tested without rendering React.
 */
export function buildWebhookCurlCommand(webhookUrl: string, projectId: string): string {
  return `curl -X POST ${webhookUrl} \\
  -H "Content-Type: application/json" \\
  -d '{
    "secretKey": "TU_SECRETO_AQUI",
    "type": "wearable",
    "source": "Smartwatch W-01",
    "metric": "Ritmo Cardíaco",
    "value": 165,
    "unit": "bpm",
    "status": "critical",
    "projectId": "${projectId}"
  }'`;
}
