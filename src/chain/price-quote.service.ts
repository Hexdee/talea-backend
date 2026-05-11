import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const LAMPORTS_PER_SOL = 1_000_000_000;
const USDC_MINOR = 1_000_000;

@Injectable()
export class PriceQuoteService {
  private readonly logger = new Logger(PriceQuoteService.name);
  private cachedSolUsdQuote: { price: number; fetchedAtMs: number } | null =
    null;
  private inFlightSolUsdQuote: Promise<number> | null = null;

  constructor(private readonly configService: ConfigService) {}

  async getSolUsdQuoteLocked() {
    const ttlMs = Number(
      this.configService.get<string>('COINGECKO_QUOTE_TTL_MS', '60000'),
    );
    const now = Date.now();
    if (
      this.cachedSolUsdQuote &&
      now - this.cachedSolUsdQuote.fetchedAtMs < ttlMs
    ) {
      return this.cachedSolUsdQuote.price;
    }

    if (this.inFlightSolUsdQuote) {
      return await this.inFlightSolUsdQuote;
    }

    const endpoint = this.configService.get<string>(
      'COINGECKO_API_BASE',
      'https://api.coingecko.com/api/v3',
    );

    this.inFlightSolUsdQuote = (async () => {
      try {
        const response = await fetch(
          `${endpoint}/simple/price?ids=solana&vs_currencies=usd`,
          {
            headers: {
              accept: 'application/json',
              // Some public APIs throttle/deny requests without a UA.
              'user-agent': 'lesenpad-backend',
            },
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (!response.ok) {
          // CoinGecko 429 = rate-limited. If we have a recent-ish cached quote,
          // fall back to it to avoid breaking payments.
          if (response.status === 429 && this.cachedSolUsdQuote) {
            this.logger.warn(
              `CoinGecko returned 429; falling back to cached SOL/USD quote (${this.cachedSolUsdQuote.price}).`,
            );
            return this.cachedSolUsdQuote.price;
          }

          const fallback = Number(
            this.configService.get<string>('SOL_USD_FALLBACK', '0'),
          );
          if (fallback > 0 && Number.isFinite(fallback)) {
            this.logger.warn(
              `CoinGecko returned ${response.status}; falling back to SOL_USD_FALLBACK (${fallback}).`,
            );
            return fallback;
          }
          throw new Error(`CoinGecko returned ${response.status}`);
        }

        const payload = (await response.json()) as {
          solana?: { usd?: number };
        };
        const price = payload.solana?.usd;

        if (!price || Number.isNaN(price) || price <= 0) {
          throw new Error('Invalid SOL/USD quote payload.');
        }

        this.cachedSolUsdQuote = { price, fetchedAtMs: Date.now() };
        return price;
      } catch (error) {
        this.logger.warn(
          `Error getting sol current rate Reason: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );

        if (this.cachedSolUsdQuote) {
          this.logger.warn(
            `Falling back to cached SOL/USD quote (${this.cachedSolUsdQuote.price}).`,
          );
          return this.cachedSolUsdQuote.price;
        }

        const fallback = Number(
          this.configService.get<string>('SOL_USD_FALLBACK', '0'),
        );
        if (fallback > 0 && Number.isFinite(fallback)) {
          this.logger.warn(`Falling back to SOL_USD_FALLBACK (${fallback}).`);
          return fallback;
        }

        throw error;
      } finally {
        this.inFlightSolUsdQuote = null;
      }
    })();

    return await this.inFlightSolUsdQuote;
  }

  async lamportsToUsdcMinorWithLockedQuote(lamports: number) {
    const price = await this.getSolUsdQuoteLocked();
    const solAmount = lamports / LAMPORTS_PER_SOL;
    const usdcMinor = Math.max(0, Math.round(solAmount * price * USDC_MINOR));

    return {
      feeInUsdcMinor: usdcMinor,
      solUsdPrice: price,
    };
  }
}
