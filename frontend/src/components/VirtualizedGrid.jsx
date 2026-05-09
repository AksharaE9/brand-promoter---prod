import React, { useRef, useMemo } from 'react';
import * as ReactWindow from 'react-window';
import * as AutoSizerModule from 'react-virtualized-auto-sizer';

const { FixedSizeGrid: Grid } = ReactWindow;
const AutoSizer = AutoSizerModule.AutoSizer || AutoSizerModule.default || AutoSizerModule;

/**
 * A highly optimized virtualized grid for enterprise datasets.
 * Handles responsive column counts and windowed rendering.
 */
const VirtualizedGrid = ({ 
  items, 
  renderItem, 
  itemHeight = 280, 
  gap = 16,
  minChildWidth = 300 
}) => {
  const containerRef = useRef(null);

  return (
    <div style={{ height: 'calc(100vh - 250px)', width: '100%' }} ref={containerRef}>
      <AutoSizer>
        {({ height, width }) => {
          const columnCount = Math.max(1, Math.floor(width / (minChildWidth + gap)));
          const rowCount = Math.ceil(items.length / columnCount);
          const columnWidth = (width - (columnCount - 1) * gap) / columnCount;

          return (
            <Grid
              columnCount={columnCount}
              columnWidth={columnWidth + gap}
              height={height}
              rowCount={rowCount}
              rowHeight={itemHeight + gap}
              width={width}
              itemData={{
                items,
                columnCount,
                renderItem,
                gap,
                columnWidth
              }}
            >
              {Cell}
            </Grid>
          );
        }}
      </AutoSizer>
    </div>
  );
};

const Cell = ({ columnIndex, rowIndex, style, data }) => {
  const { items, columnCount, renderItem, gap, columnWidth } = data;
  const index = rowIndex * columnCount + columnIndex;

  if (index >= items.length) return null;

  return (
    <div 
      style={{ 
        ...style, 
        paddingRight: columnIndex === columnCount - 1 ? 0 : gap,
        paddingBottom: gap,
        boxSizing: 'border-box'
      }}
    >
      <div style={{ width: columnWidth }}>
        {renderItem(items[index], index)}
      </div>
    </div>
  );
};

export default React.memo(VirtualizedGrid);
