import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  FilterInterpretation,
  PageRequest,
  PageResult,
  ResultView,
} from '../datasources/connectors/paged-sql.types';
import type { ChatMessage } from './entities/session.entity';
import {
  AnswerEvidenceService,
  type AnswerHost,
} from './query-evidence/answer-evidence.service';
import { withDerivedEvidence } from './query-evidence/query-evidence';
import type {
  QueryExport,
  QueryRerunResult,
} from './query-evidence/query-evidence.service';
import { SessionsService } from './sessions.service';

/**
 * The query inspector on a past chat (api.md 144-148, 154): a session's
 * assistant message with `data` is an answer host. Who may call is who may
 * read the session (`SessionsService.get`, as `GET /sessions/:id`: 404
 * `Session <id> not found`). What 144-146 find is written into the stored
 * message, under the engine's lock keyed by session and message.
 */
@Injectable()
export class SessionEvidenceService {
  constructor(
    private readonly sessions: SessionsService,
    private readonly answers: AnswerEvidenceService,
  ) {}

  /** 144: build the message's evidence and size its tables. */
  prepare(id: string, message: number): Promise<ChatMessage> {
    return this.answers.prepare(this.host(id, message));
  }

  /** 145: explain one query step by step. */
  explain(
    id: string,
    message: number,
    index: number,
    refresh = false,
  ): Promise<ChatMessage> {
    return this.answers.explain(this.host(id, message), index, refresh);
  }

  /** 162: the first rows one step of an explained query leaves. */
  previewStep(
    id: string,
    message: number,
    index: number,
    step: number,
  ): Promise<ChatMessage> {
    return this.answers.previewStep(this.host(id, message), index, step);
  }

  /** 146: count the rows after each step of an explained query. */
  countSteps(id: string, message: number, index: number): Promise<ChatMessage> {
    return this.answers.countSteps(this.host(id, message), index);
  }

  /** 147: run one query again; nothing is stored. */
  rerun(id: string, message: number, index: number): Promise<QueryRerunResult> {
    return this.answers.rerun(this.host(id, message), index);
  }

  /** 154: one page of one query's full result, filtered and sorted; nothing is stored. */
  page(
    id: string,
    message: number,
    index: number,
    request: PageRequest,
  ): Promise<PageResult> {
    return this.answers.page(this.host(id, message), index, request);
  }

  /** 155: the user's words read as a view of one query; nothing is stored. */
  interpretFilter(
    id: string,
    message: number,
    index: number,
    text: string,
    view: ResultView | null,
  ): Promise<FilterInterpretation> {
    return this.answers.interpretFilter(
      this.host(id, message),
      index,
      text,
      view,
    );
  }

  /**
   * 148: one query's rows as CSV, the file
   * `query-<Q>-<first 8 of the session id>-<message>.csv`.
   */
  async queryCsv(
    id: string,
    message: number,
    index: number,
  ): Promise<QueryExport & { filename: string; q: number }> {
    const exported = await this.answers.exportRows(
      this.host(id, message),
      index,
    );
    return {
      ...exported,
      filename: `query-${exported.q}-${id.slice(0, 8)}-${message}.csv`,
    };
  }

  private host(id: string, index: number): AnswerHost<ChatMessage> {
    return {
      key: `session:${id}:${index}`,
      owner: 'message',
      load: async () => {
        const session = await this.sessions.get(id);
        const message = session.messages[index];
        if (!message || message.role !== 'assistant' || !message.data?.length) {
          throw new BadRequestException(
            `Message ${index} has no answer with queries`,
          );
        }
        return {
          answer: message,
          datasets: session.datasets,
          view: () => Promise.resolve(withDerivedEvidence(message)),
          save: async (answer) => {
            // Two messages of one session are written one at a time: each
            // write re-reads the session's messages.
            await this.answers.withLock(`session:${id}`, () =>
              this.sessions.saveMessage(id, index, answer),
            );
            return answer;
          },
        };
      },
    };
  }
}
