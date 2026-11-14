import { Router, Request, Response } from "express";
import { config } from "../../config/environment";
import { requirePermissionKey } from "../../middleware/auth.middleware";

// Call history and test calls go to the Voice & Message Assistant Backend; only people who run
// module 32 may use them.
const canSeeCalls = requirePermissionKey("voice-ai.view_analytics", "voice-ai.manage_escalations");

export const voiceGatewayRouter = Router();

// Retrieve Call History from Voice Backend
voiceGatewayRouter.get("/voice/calls", canSeeCalls, async (req: Request, res: Response): Promise<void> => {
  try {
    const institutionId = req.institutionId || "inst-001";
    const voiceRes = await fetch(`${config.voiceApiUrl}/voice/calls/history?institution_id=${institutionId}&limit=50`, {
      method: "GET",
      headers: {
        "X-Service-Token": config.serviceSecretVoice,
        "X-Institution-Id": institutionId
      }
    });

    if (!voiceRes.ok) {
      const errText = await voiceRes.text();
      res.status(voiceRes.status).json({ success: false, statusCode: voiceRes.status, error: `Voice Service Error: ${errText}` });
      return;
    }

    const data = await voiceRes.json();
    res.status(200).json({ success: true, statusCode: 200, data: data.data || [] });
  } catch (err: any) {
    console.error("Voice Calls Gateway Error:", err);
    res.status(502).json({ success: false, statusCode: 502, error: `Failed to connect to Voice Backend: ${err.message}` });
  }
});

// Trigger Call Simulation via Voice Backend
voiceGatewayRouter.post("/voice/simulate", canSeeCalls, async (req: Request, res: Response): Promise<void> => {
  try {
    const institutionId = req.institutionId || "inst-001";
    const { callerPhone, callerName, channel, messages } = req.body;

    const payload = {
      institution_id: institutionId,
      caller_phone: callerPhone || "+8801700000000",
      caller_name: callerName || "Guardian",
      channel: channel || "TWILIO",
      messages: messages || ["Hello, I need information."]
    };

    const voiceRes = await fetch(`${config.voiceApiUrl}/voice/simulate/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Token": config.serviceSecretVoice,
        "X-Institution-Id": institutionId
      },
      body: JSON.stringify(payload)
    });

    if (!voiceRes.ok) {
      const errText = await voiceRes.text();
      res.status(voiceRes.status).json({ success: false, statusCode: voiceRes.status, error: `Voice Service Error: ${errText}` });
      return;
    }

    const data = await voiceRes.json();
    res.status(200).json({ success: true, statusCode: 200, data: data.data });
  } catch (err: any) {
    console.error("Voice Simulate Gateway Error:", err);
    res.status(502).json({ success: false, statusCode: 502, error: `Failed to connect to Voice Backend: ${err.message}` });
  }
});

