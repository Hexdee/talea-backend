import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const LAMPORTS_PER_SOL = 1_000_000_000;
const USDC_MINOR = 1_000_000;

@Injectable()
export class PriceQuoteService {
  private readonly logger = new Logger(PriceQuoteService.name);

  constructor(private readonly configService: ConfigService) {}

  async getSolUsdQuoteLocked() {
    const endpoint = this.configService.get<string>(
      'COINGECKO_API_BASE',
      'https://api.coingecko.com/api/v3',
    );

    try {
      const response = await fetch(
        `${endpoint}/simple/price?ids=solana&vs_currencies=usd`,
      );
      if (!response.ok) {
        throw new Error(`CoinGecko returned ${response.status}`);
      }

      const payload = (await response.json()) as {
        solana?: { usd?: number };
      };
      const price = payload.solana?.usd;

      if (!price || Number.isNaN(price) || price <= 0) {
        throw new Error('Invalid SOL/USD quote payload.');
      }

      return price;
    } catch (error) {
      this.logger.warn(
        `Error getting sol current rate Reason: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      throw error;
    }
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
