import { Request, Response } from 'express';
import { successResponse, errorResponse } from '../utils/response';
import prisma from '../config/prisma';
import { z } from 'zod';

const createCategorySchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
});

export class CategoryController {
  static async getCategories(req: Request, res: Response) {
    try {
      const categories = await prisma.category.findMany({
        include: {
          _count: {
            select: { videos: true },
          },
        },
        orderBy: { name: 'asc' },
      });

      successResponse(res, categories);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async getCategory(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const category = await prisma.category.findUnique({
        where: { id },
        include: {
          _count: {
            select: { videos: true },
          },
        },
      });

      if (!category) {
        return errorResponse(res, 'Category not found', 404);
      }

      successResponse(res, category);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async createCategory(req: Request, res: Response) {
    try {
      const validated = createCategorySchema.parse(req.body);

      const existing = await prisma.category.findUnique({
        where: { name: validated.name },
      });

      if (existing) {
        return errorResponse(res, 'Category already exists', 409);
      }

      const category = await prisma.category.create({
        data: validated as any,
      });

      successResponse(res, category, 'Category created successfully', 201);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return errorResponse(res, error.errors.map(e => e.message).join(', '), 400);
      }
      errorResponse(res, error.message, 500);
    }
  }

  static async updateCategory(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const validated = createCategorySchema.partial().parse(req.body);

      const category = await prisma.category.update({
        where: { id },
        data: validated,
      });

      successResponse(res, category, 'Category updated successfully');
    } catch (error: any) {
      if (error.code === 'P2025') {
        return errorResponse(res, 'Category not found', 404);
      }
      if (error instanceof z.ZodError) {
        return errorResponse(res, error.errors.map(e => e.message).join(', '), 400);
      }
      errorResponse(res, error.message, 500);
    }
  }

  static async deleteCategory(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const videosCount = await prisma.video.count({ where: { categoryId: id } });
      if (videosCount > 0) {
        return errorResponse(res, 'Cannot delete category with videos', 400);
      }

      await prisma.category.delete({ where: { id } });
      successResponse(res, null, 'Category deleted successfully');
    } catch (error: any) {
      if (error.code === 'P2025') {
        return errorResponse(res, 'Category not found', 404);
      }
      errorResponse(res, error.message, 500);
    }
  }
}

export class TagController {
  static async getTags(req: Request, res: Response) {
    try {
      const search = req.query.search as string;
      const limit = parseInt(req.query.limit as string) || 50;

      const where = search ? { name: { contains: search, mode: 'insensitive' as const } } : {};

      const tags = await prisma.tag.findMany({
        where,
        take: limit,
        include: {
          _count: {
            select: { videos: true },
          },
        },
        orderBy: { name: 'asc' },
      });

      successResponse(res, tags);
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async createTag(req: Request, res: Response) {
    try {
      const { name } = req.body;

      if (!name || name.trim().length === 0) {
        return errorResponse(res, 'Tag name is required', 400);
      }

      const [tag, created] = await prisma.tag.upsert({
        where: { name: name.trim() },
        create: { name: name.trim() },
        update: {},
        include: {
          _count: {
            select: { videos: true },
          },
        },
      })
        .then((tag) => [tag, true])
        .catch(async () => {
          const existing = await prisma.tag.findUnique({
            where: { name: name.trim() },
            include: { _count: { select: { videos: true } } },
          });
          return [existing, false];
        });

      successResponse(res, { tag, created }, created ? 'Tag created successfully' : 'Tag already exists');
    } catch (error: any) {
      errorResponse(res, error.message, 500);
    }
  }

  static async deleteTag(req: Request, res: Response) {
    try {
      const { id } = req.params;

      await prisma.$transaction([
        prisma.videoTag.deleteMany({ where: { tagId: id } }),
        prisma.tag.delete({ where: { id } }),
      ]);

      successResponse(res, null, 'Tag deleted successfully');
    } catch (error: any) {
      if (error.code === 'P2025') {
        return errorResponse(res, 'Tag not found', 404);
      }
      errorResponse(res, error.message, 500);
    }
  }
}
