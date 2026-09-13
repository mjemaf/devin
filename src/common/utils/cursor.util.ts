import { Base64 } from 'js-base64';

/**
 * Cursor pagination utility
 * 
 * Provides opaque cursor encoding/decoding for cursor-based pagination
 */
export class CursorUtil {
  /**
   * Encode cursor data into an opaque base64 string
   */
  static encode(data: any): string {
    const json = JSON.stringify(data);
    return Base64.encode(json);
  }

  /**
   * Decode opaque cursor string into data
   */
  static decode(cursor: string): any {
    try {
      const json = Base64.decode(cursor);
      return JSON.parse(json);
    } catch (error) {
      throw new Error('Invalid cursor format');
    }
  }

  /**
   * Create a cursor from an ID and timestamp
   */
  static createFromId(id: string, timestamp: Date): string {
    return this.encode({
      id,
      timestamp: timestamp.getTime(),
    });
  }

  /**
   * Extract ID from cursor
   */
  static extractId(cursor: string): string {
    const data = this.decode(cursor);
    return data.id;
  }

  /**
   * Extract timestamp from cursor
   */
  static extractTimestamp(cursor: string): Date {
    const data = this.decode(cursor);
    return new Date(data.timestamp);
  }

  /**
   * Validate cursor format
   */
  static isValid(cursor: string): boolean {
    try {
      this.decode(cursor);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Paginated response interface
 */
export interface PaginatedResponse<T> {
  data: T[];
  cursor: string | null;
  hasMore: boolean;
  limit: number;
}

/**
 * Cursor pagination options
 */
export interface CursorPaginationOptions {
  limit?: number;
  cursor?: string;
  filters?: Record<string, any>;
}
