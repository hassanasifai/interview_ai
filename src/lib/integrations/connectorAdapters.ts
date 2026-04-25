export type ConnectorPlatform = 'zoom' | 'google-meet';

type ConnectorFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ConnectorAdapterConfig = {
  zoomAccessToken?: string;
  googleAccessToken?: string;
  fetcher?: ConnectorFetcher;
};

export type ConnectorHealth = {
  platform: ConnectorPlatform;
  configured: boolean;
  mode: 'configured' | 'not-configured' | 'error';
  note: string;
};

export type ConnectorMeeting = {
  id: string;
  platform: ConnectorPlatform;
  title: string;
  startsAt: string;
  joinUrl: string;
};

export interface MeetingConnectorAdapter {
  platform: ConnectorPlatform;
  getHealth: () => Promise<ConnectorHealth>;
  fetchUpcomingMeetings: (limit?: number) => Promise<ConnectorMeeting[]>;
}

class ZoomConnectorAdapter implements MeetingConnectorAdapter {
  platform: ConnectorPlatform = 'zoom';
  private readonly accessToken: string;
  private readonly fetcher: ConnectorFetcher;

  constructor(accessToken: string, fetcher: ConnectorFetcher) {
    this.accessToken = accessToken.trim();
    this.fetcher = fetcher;
  }

  private async request(path: string) {
    return this.fetcher(`https://api.zoom.us/v2/${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
  }

  async getHealth(): Promise<ConnectorHealth> {
    if (!this.accessToken) {
      return {
        platform: this.platform,
        configured: false,
        mode: 'not-configured',
        note: 'Zoom access token is not set.',
      };
    }

    try {
      const response = await this.request('users/me');

      if (!response.ok) {
        return {
          platform: this.platform,
          configured: true,
          mode: 'error',
          note:
            response.status === 401 || response.status === 403
              ? 'Zoom token was rejected (expired or invalid scope).'
              : `Zoom health probe failed with status ${response.status}.`,
        };
      }

      return {
        platform: this.platform,
        configured: true,
        mode: 'configured',
        note: 'Zoom API credentials validated successfully.',
      };
    } catch {
      return {
        platform: this.platform,
        configured: true,
        mode: 'error',
        note: 'Zoom probe failed due to network, CORS, or runtime policy constraints.',
      };
    }
  }

  async fetchUpcomingMeetings(limit = 5): Promise<ConnectorMeeting[]> {
    if (!this.accessToken) {
      return [];
    }

    try {
      const response = await this.request(
        `users/me/meetings?type=upcoming&page_size=${Math.max(1, limit)}`,
      );

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as {
        meetings?: Array<{
          id?: number | string;
          topic?: string;
          start_time?: string;
          join_url?: string;
        }>;
      };

      return (data.meetings ?? []).map((meeting) => ({
        id: String(meeting.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        platform: this.platform,
        title: meeting.topic?.trim() || 'Zoom meeting',
        startsAt: meeting.start_time ?? '',
        joinUrl: meeting.join_url ?? '',
      }));
    } catch {
      return [];
    }
  }
}

class GoogleMeetConnectorAdapter implements MeetingConnectorAdapter {
  platform: ConnectorPlatform = 'google-meet';
  private readonly accessToken: string;
  private readonly fetcher: ConnectorFetcher;

  constructor(accessToken: string, fetcher: ConnectorFetcher) {
    this.accessToken = accessToken.trim();
    this.fetcher = fetcher;
  }

  private async request(path: string) {
    return this.fetcher(`https://www.googleapis.com/calendar/v3/${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
  }

  async getHealth(): Promise<ConnectorHealth> {
    if (!this.accessToken) {
      return {
        platform: this.platform,
        configured: false,
        mode: 'not-configured',
        note: 'Google access token is not set.',
      };
    }

    try {
      const response = await this.request('users/me/calendarList?maxResults=1');

      if (!response.ok) {
        return {
          platform: this.platform,
          configured: true,
          mode: 'error',
          note:
            response.status === 401 || response.status === 403
              ? 'Google token was rejected (expired or invalid scope).'
              : `Google Calendar probe failed with status ${response.status}.`,
        };
      }

      return {
        platform: this.platform,
        configured: true,
        mode: 'configured',
        note: 'Google Calendar credentials validated successfully.',
      };
    } catch {
      return {
        platform: this.platform,
        configured: true,
        mode: 'error',
        note: 'Google probe failed due to network, CORS, or runtime policy constraints.',
      };
    }
  }

  async fetchUpcomingMeetings(limit = 5): Promise<ConnectorMeeting[]> {
    if (!this.accessToken) {
      return [];
    }

    const now = new Date().toISOString();

    try {
      const query = new URLSearchParams({
        maxResults: String(Math.max(1, limit)),
        orderBy: 'startTime',
        singleEvents: 'true',
        timeMin: now,
      });
      const response = await this.request(`calendars/primary/events?${query.toString()}`);

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as {
        items?: Array<{
          id?: string;
          summary?: string;
          htmlLink?: string;
          start?: {
            dateTime?: string;
            date?: string;
          };
        }>;
      };

      return (data.items ?? []).map((event) => ({
        id: event.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        platform: this.platform,
        title: event.summary?.trim() || 'Google Meet session',
        startsAt: event.start?.dateTime ?? event.start?.date ?? '',
        joinUrl: event.htmlLink ?? '',
      }));
    } catch {
      return [];
    }
  }
}

function resolveFetcher(fetcher?: ConnectorFetcher): ConnectorFetcher {
  if (fetcher) {
    return fetcher;
  }

  return (input, init) => fetch(input, init);
}

export function getConnectorAdapters(config?: ConnectorAdapterConfig): MeetingConnectorAdapter[] {
  const fetcher = resolveFetcher(config?.fetcher);

  return [
    new ZoomConnectorAdapter(config?.zoomAccessToken ?? '', fetcher),
    new GoogleMeetConnectorAdapter(config?.googleAccessToken ?? '', fetcher),
  ];
}
