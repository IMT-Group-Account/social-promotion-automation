import { ImageResponse } from 'next/og';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default function Icon(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: 'center',
          background: '#18654f',
          color: '#ffffff',
          display: 'flex',
          fontSize: 20,
          fontWeight: 800,
          height: '100%',
          justifyContent: 'center',
          width: '100%',
        }}
      >
        SNS
      </div>
    ),
    size,
  );
}
