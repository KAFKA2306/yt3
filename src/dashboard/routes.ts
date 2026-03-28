import { Router, type Request, type Response } from "express";

export function createDashboardRoutes(): Router {
	const router = Router();

	router.get("/quota", (req: Request, res: Response) => {
		res.send(`
<!DOCTYPE html>
<html lang="ja">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Gemini API Quota Dashboard</title>
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f5f5; padding: 20px; }
		.container { max-width: 1200px; margin: 0 auto; }
		h1 { color: #333; margin-bottom: 30px; }
		.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 20px; }
		.card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
		.card-title { font-size: 18px; font-weight: 600; margin-bottom: 15px; color: #333; }
		.stat { display: flex; justify-content: space-between; margin-bottom: 12px; }
		.stat-label { color: #666; }
		.stat-value { font-weight: 600; color: #333; }
		.progress-bar { width: 100%; height: 8px; background: #eee; border-radius: 4px; overflow: hidden; margin-top: 8px; }
		.progress { height: 100%; background: linear-gradient(90deg, #10b981, #f59e0b, #ef4444); transition: width 0.3s; }
		.status { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
		.status.active { background: #dbeafe; color: #1e40af; }
		.status.cooldown { background: #fee2e2; color: #b91c1c; }
		.alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin-bottom: 15px; border-radius: 4px; }
		.button { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
		.button-primary { background: #3b82f6; color: white; }
		.button-primary:hover { background: #2563eb; }
		.refresh-time { color: #999; font-size: 12px; margin-top: 15px; }
	</style>
</head>
<body>
	<div class="container">
		<h1>🔑 Gemini API Quota Dashboard</h1>
		
		<div id="alerts"></div>
		<div id="keys-grid" class="grid"></div>
		<div class="refresh-time">Last updated: <span id="timestamp">-</span></div>
	</div>

	<script>
		const API_BASE = '/api/quota';
		const REFRESH_INTERVAL = 30000; // 30 seconds

		async function updateQuota() {
			try {
				const res = await fetch(API_BASE + '/all');
				const data = await res.json();
				
				if (data.success) {
					renderKeys(data.keys);
					renderAlerts(data.keys);
					document.getElementById('timestamp').textContent = new Date().toLocaleTimeString();
				}
			} catch (err) {
				console.error('Failed to fetch quota:', err);
			}
		}

		function renderKeys(keys) {
			const grid = document.getElementById('keys-grid');
			grid.innerHTML = keys.map(key => \`
				<div class="card">
					<div class="card-title">
						\${key.name}
						<span class="status \${key.status}">\${key.status.toUpperCase()}</span>
					</div>
					
					<div class="stat">
						<span class="stat-label">Requests</span>
						<span class="stat-value">\${key.remaining}/15</span>
					</div>
					<div class="progress-bar">
						<div class="progress" style="width: \${key.requestPercent}%"></div>
					</div>
					
					<div class="stat" style="margin-top: 15px;">
						<span class="stat-label">Tokens</span>
						<span class="stat-value">\${(key.remainingTokens / 1000000).toFixed(2)}M / 1M</span>
					</div>
					<div class="progress-bar">
						<div class="progress" style="width: \${key.tokenPercent}%"></div>
					</div>
					
					<div class="stat" style="margin-top: 15px;">
						<span class="stat-label">Backoff Level</span>
						<span class="stat-value">\${key.backoffLevel}</span>
					</div>
					
					<div class="stat">
						<span class="stat-label">Reset Time</span>
						<span class="stat-value">\${new Date(key.resetTime).toLocaleTimeString()}</span>
					</div>
					
					<button class="button button-primary" onclick="rotateKey('\${key.name}')" style="width: 100%; margin-top: 15px;">
						Switch Key
					</button>
				</div>
			\`).join('');
		}

		function renderAlerts(keys) {
			const alerts = document.getElementById('alerts');
			const lowQuotaKeys = keys.filter(k => k.isLowQuota);
			
			if (lowQuotaKeys.length === 0) {
				alerts.innerHTML = '';
				return;
			}

			alerts.innerHTML = \`
				<div class="alert">
					⚠️ Low quota alert for: \${lowQuotaKeys.map(k => k.name).join(', ')}
				</div>
			\`;
		}

		async function rotateKey(keyName) {
			try {
				const res = await fetch(API_BASE + '/rotate', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ sessionId: 'dashboard' })
				});
				const data = await res.json();
				
				if (data.success) {
					alert(\`Switched to: \${data.key}\`);
					updateQuota();
				} else {
					alert(\`Error: \${data.error}\`);
				}
			} catch (err) {
				alert('Failed to rotate key: ' + err.message);
			}
		}

		// Initial load and periodic refresh
		updateQuota();
		setInterval(updateQuota, REFRESH_INTERVAL);
	</script>
</body>
</html>
		`);
	});

	return router;
}
