import { EmailMessage } from 'cloudflare:email';
import PostalMime from 'postal-mime';

// 1. Define Env Interface
export interface Env {
  DB: D1Database;
}

// 2. Define D1 Row Type
interface EmailRow {
  id: string;
  recipient: string;
  sender: string;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  created_at: number;
}

export default {
  // ---------------------------------------------------------
  // EMAIL HANDLER: Receives and stores incoming mail
  // ---------------------------------------------------------
  async email(message: EmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    const processEmail = async () => {
      try {
        const parser = new PostalMime();
        // Parse the raw email stream
        const parsedEmail = await parser.parse(message.raw);

        const id = crypto.randomUUID();
        const recipient = message.to;
        const sender = message.from;
        const subject = parsedEmail.subject || '(No Subject)';
        const textBody = parsedEmail.text || null;
        const htmlBody = parsedEmail.html || null;
        const createdAt = Date.now();

        // Store in D1
        await env.DB.prepare(
          `INSERT INTO emails (id, recipient, sender, subject, text_body, html_body, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, recipient, sender, subject, textBody, htmlBody, createdAt).run();
      } catch (error) {
        console.error('Error processing email:', error);
      }
    };
    
    // Wait for the async processing to finish without blocking the worker
    ctx.waitUntil(processEmail());
  },

  // ---------------------------------------------------------
  // FETCH HANDLER: Serves API for Frontend
  // ---------------------------------------------------------
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // API: GET /api/emails?address=random@visatk.us
    if (url.pathname === '/api/emails' && request.method === 'GET') {
      const address = url.searchParams.get('address');

      if (!address) {
        return new Response('Address required', { status: 400 });
      }

      try {
        const { results } = await env.DB.prepare(
          `SELECT id, sender, subject, created_at, text_body
           FROM emails
           WHERE recipient = ?
           ORDER BY created_at DESC
           LIMIT 50`
        ).bind(address).all<EmailRow>(); // Strictly type D1 result

        return Response.json({ emails: results });
      } catch (error) {
        return new Response('Database Error', { status: 500 });
      }
    }

    // Health Check
    return new Response('Temp Mail Service Running', { status: 200 });
  },
} satisfies ExportedHandler<Env>;
