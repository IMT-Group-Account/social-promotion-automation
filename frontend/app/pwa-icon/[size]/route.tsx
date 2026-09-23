import { ImageResponse } from 'next/og';

const allowedSizes = new Set([192, 512]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ size: string }> },
): Promise<Response> {
  const size = Number((await params).size);
  if (!allowedSizes.has(size)) return new Response('Not found', { status: 404 });

  return new ImageResponse(
    (
      <div
        style={{
          alignItems: 'center',
          background: '#18654f',
          color: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          justifyContent: 'center',
          width: '100%',
        }}
      >
        <div
          style={{
            alignItems: 'center',
            border: `${Math.max(6, Math.round(size / 48))}px solid rgba(255,255,255,.9)`,
            borderRadius: '28%',
            display: 'flex',
            fontSize: Math.round(size * 0.23),
            fontWeight: 800,
            height: '62%',
            justifyContent: 'center',
            letterSpacing: '-0.04em',
            width: '62%',
          }}
        >
          SNS
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
