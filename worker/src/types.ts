export interface Env {
  USERS: KVNamespace;
  TELEGRAM_BOT_TOKEN: string;
  DATA_GO_KR_KEY: string;
  WEBHOOK_SECRET: string;
}

export interface Region {
  sido: string;
  sigungu: string;
}

export interface User {
  regions: Region[];       // 1~2개 등록 지역
  name: string;
  rainAlert?: boolean;     // 실시간 비 알람 옵트인 여부
  // gridKey("nx,ny") → 마지막 비 알람을 보낸 시각 "YYYYMMDDHH". 같은 비 도배 방지용.
  rainSeen?: Record<string, string>;
}

export const MAX_REGIONS = 2;

export interface TgChat { id: number | string; }
export interface TgUser { first_name?: string; }
export interface TgMessage { chat: TgChat; message_id: number; text?: string; }
export interface TgCallback {
  id: string;
  data?: string;
  message: TgMessage;
  from?: TgUser;
}
export interface TgUpdate {
  message?: TgMessage;
  callback_query?: TgCallback;
}

export interface InlineButton { text: string; callback_data: string; }
export interface InlineKeyboard { inline_keyboard: InlineButton[][]; }
