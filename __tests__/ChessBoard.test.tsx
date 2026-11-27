import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import ChessBoard from '../src/components/ChessBoard';
import { GameEngine } from '../src/lib/chess/game';
import { I18nProvider } from '../src/lib/i18n/context';

jest.mock('react-chessboard', () => {
  const React = jest.requireActual<typeof import('react')>('react');

  return {
    Chessboard: ({ options }: {
      options: {
        onSquareClick?: (args: { piece: { pieceType: string } | null; square: string }) => void;
        position: string;
        boardStyle?: React.CSSProperties;
      };
    }) => {
      const piecesBySquare: Record<string, { pieceType: string }> = {
        e2: { pieceType: 'wP' },
        e7: { pieceType: 'bP' },
        a7: { pieceType: 'wP' },
      };

      return React.createElement(
        'div',
        {
          'data-testid': 'board',
          'data-position': options.position,
          'data-board-width': options.boardStyle?.width,
          'data-board-height': options.boardStyle?.height,
          'data-board-position': options.boardStyle?.position,
        },
        ...['e2', 'e4', 'e7', 'e5', 'a7', 'a8'].map((square) => React.createElement(
          'button',
          {
            key: square,
            type: 'button',
            onClick: () => options.onSquareClick?.({
              piece: piecesBySquare[square] ?? null,
              square,
            }),
          },
          square
        ))
      );
    },
  };
});

describe('ChessBoard interactions', () => {
  it('keeps the rendered board square and fills its square container', () => {
    render(
      <I18nProvider>
        <ChessBoard
          engine={new GameEngine()}
          onReset={jest.fn()}
          isWhitePlayer
        />
      </I18nProvider>,
    );

    const board = screen.getByTestId('board');
    expect(board.parentElement?.classList.contains('aspect-square')).toBe(true);
    expect(board.getAttribute('data-board-width')).toBe('100%');
    expect(board.getAttribute('data-board-height')).toBe('100%');
    expect(board.getAttribute('data-board-position')).toBe('absolute');
  });

  it('lets both local players make alternating legal moves', () => {
    const engine = new GameEngine();
    const onMove = jest.fn();
    render(React.createElement(I18nProvider, null, React.createElement(ChessBoard, {
      engine,
      onMove,
      onReset: jest.fn(),
      isWhitePlayer: true,
      isHotSeat: true,
    })));

    fireEvent.click(screen.getByRole('button', { name: 'e2' }));
    fireEvent.click(screen.getByRole('button', { name: 'e4' }));
    fireEvent.click(screen.getByRole('button', { name: 'e7' }));
    fireEvent.click(screen.getByRole('button', { name: 'e5' }));

    expect(engine.moveHistory.map((move) => move.move)).toEqual(['e4', 'e5']);
    expect(onMove.mock.calls.map(([move]) => move)).toEqual(['e2e4', 'e7e5']);
  });

  it('presents a promotion choice and completes the selected promotion', () => {
    const engine = new GameEngine('7k/P7/8/8/8/8/8/7K w - - 0 1');
    const onMove = jest.fn();
    render(React.createElement(I18nProvider, null, React.createElement(ChessBoard, {
      engine,
      onMove,
      onReset: jest.fn(),
      isWhitePlayer: true,
    })));

    fireEvent.click(screen.getByRole('button', { name: 'a7' }));
    fireEvent.click(screen.getByRole('button', { name: 'a8' }));
    fireEvent.click(screen.getByRole('button', { name: 'Promote to knight' }));

    expect(engine.getPieceAt('a8')).toEqual({ type: 'n', color: 'w' });
    expect(onMove).toHaveBeenCalledWith('a7a8n');
  });

  it('undoes both plies for a bot game and resets the board', () => {
    const engine = new GameEngine();
    engine.moveFromSquares('e2', 'e4');
    engine.moveFromSquares('e7', 'e5');
    const onPositionChange = jest.fn();
    const onReset = jest.fn();
    render(React.createElement(I18nProvider, null, React.createElement(ChessBoard, {
      engine,
      onMove: jest.fn(),
      onPositionChange,
      onReset,
      isWhitePlayer: true,
      undoPlies: 2,
    })));

    fireEvent.click(screen.getByRole('button', { name: 'Undo move' }));
    expect(engine.moveHistory).toHaveLength(0);
    expect(onPositionChange).toHaveBeenCalledTimes(1);

    engine.moveFromSquares('e2', 'e4');
    fireEvent.click(screen.getByRole('button', { name: 'Reset Board' }));
    expect(engine.moveHistory).toHaveLength(0);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
