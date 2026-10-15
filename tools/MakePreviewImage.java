// Draws preview.png, the picture WhatsApp/Discord show when someone shares the site link.
// Run from the project folder:  java tools/MakePreviewImage.java
import java.awt.*;
import java.awt.geom.*;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

public class MakePreviewImage {
    static final int WIDTH = 1200, HEIGHT = 630; // the size link previews expect
    static final Color BACKGROUND = new Color(0x302e2b);
    static final Color WOOD = new Color(0xdcb35c);
    static final Color LINE = new Color(0x3b2a14);
    static final Color TEXT = new Color(0xe8e6e3);
    static final Color TEXT_DIM = new Color(0xa09d99);
    static final Color ACCENT = new Color(0x81b64c);

    public static void main(String[] args) throws Exception {
        BufferedImage image = new BufferedImage(WIDTH, HEIGHT, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        g.setColor(BACKGROUND);
        g.fillRect(0, 0, WIDTH, HEIGHT);

        drawBoard(g, 60, 65, 500);
        drawText(g, 630);

        g.dispose();
        ImageIO.write(image, "png", new File("preview.png"));
        System.out.println("Wrote preview.png");
    }

    // A 9x9 corner of a game in progress.
    static void drawBoard(Graphics2D g, int left, int top, int size) {
        g.setColor(WOOD);
        g.fill(new RoundRectangle2D.Double(left, top, size, size, 18, 18));
        int lines = 9;
        double margin = size / 10.0, cell = (size - 2 * margin) / (lines - 1);
        g.setColor(LINE);
        g.setStroke(new BasicStroke(2.2f));
        for (int k = 0; k < lines; k++) {
            double pos = margin + k * cell;
            g.draw(new Line2D.Double(left + margin, top + pos, left + size - margin, top + pos));
            g.draw(new Line2D.Double(left + pos, top + margin, left + pos, top + size - margin));
        }
        for (int[] star : new int[][] {{2, 2}, {6, 2}, {4, 4}, {2, 6}, {6, 6}}) {
            fillCircle(g, left + margin + star[0] * cell, top + margin + star[1] * cell, 6, LINE);
        }
        int[][] black = {{2, 2}, {3, 3}, {2, 4}, {4, 5}, {5, 3}, {6, 6}, {3, 6}};
        int[][] white = {{3, 2}, {4, 3}, {4, 4}, {5, 5}, {6, 3}, {5, 6}};
        for (int[] s : black) drawStone(g, left + margin + s[0] * cell, top + margin + s[1] * cell, cell * 0.47, true);
        for (int[] s : white) drawStone(g, left + margin + s[0] * cell, top + margin + s[1] * cell, cell * 0.47, false);
    }

    static void drawStone(Graphics2D g, double cx, double cy, double r, boolean black) {
        Color[] colors = black
            ? new Color[] {new Color(0x5a5a5a), new Color(0x050505)}
            : new Color[] {Color.WHITE, new Color(0xc8c8c8)};
        Point2D focus = new Point2D.Double(cx - r * 0.3, cy - r * 0.3);
        g.setPaint(new RadialGradientPaint(focus, (float) (r * 1.4), new float[] {0f, 1f}, colors));
        g.fill(new Ellipse2D.Double(cx - r, cy - r, 2 * r, 2 * r));
    }

    static void fillCircle(Graphics2D g, double cx, double cy, double r, Color color) {
        g.setColor(color);
        g.fill(new Ellipse2D.Double(cx - r, cy - r, 2 * r, 2 * r));
    }

    static void drawText(Graphics2D g, int left) {
        g.setColor(TEXT);
        g.setFont(new Font("SansSerif", Font.BOLD, 96));
        g.drawString("GoBoard", left, 245);

        g.setColor(ACCENT);
        g.fillRoundRect(left, 280, 120, 10, 10, 10);

        g.setColor(TEXT);
        g.setFont(new Font("SansSerif", Font.BOLD, 40));
        g.drawString("Play Go free in", left, 360);
        g.drawString("your browser", left, 410);

        g.setColor(TEXT_DIM);
        g.setFont(new Font("SansSerif", Font.PLAIN, 32));
        g.drawString("Friends  ·  5 bots  ·  Online", left, 480);
    }
}
